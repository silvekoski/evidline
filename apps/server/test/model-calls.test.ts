import { createInference } from "../src/persist";
import { afterEach, beforeEach, expect, it } from "vitest";
import { EgressPayload, type DiagnosisInference, type Evidence } from "@tpm/schemas";
import { runModelCalls } from "../src/model-calls";
import { explanationPayload } from "../src/payloads";
import { verifyLog } from "../src/log";
import { fixture, run, type Fixture } from "./fixture";

let f: Fixture;
const evidenceId = "ev-0123abcd-00001";
const diagnosis: DiagnosisInference = {
  id: "inf-0123abcd-00001", seq: 1, runId: "0123abcd", sensor: null, stage: "diagnosis", claim: "Unknown", confidence: 0.7, evidenceIds: [evidenceId], status: "proposed", supersedes: null,
  value: { faultClass: "sensor-dead", window: { from: 0, to: 500, n: 500 }, onset: 0, ranked: [], excluded: [], pca: null, prose: null,
    trace: [{ index: 0, test: "verdict", name: "Verdict", n: 500, stats: { n: 500 }, result: "The evidence indicates a failed sensor.", evidenceIds: [evidenceId] }] },
};
beforeEach(() => {
  f = fixture();
  f.ctx.db.runs.save(run("0123abcd"));
  f.ctx.db.inferences.save(diagnosis);
  f.ctx.db.evidence.saveAll([{ id: evidenceId, runId: "0123abcd", kind: "residual", sensors: [], window: { from: 0, to: 500, n: 500 }, method: "test", stats: { n: 500 }, verdict: "failed", chart: { type: "line", window: { from: 0, to: 500, n: 500 }, series: [] } } satisfies Evidence]);
});
afterEach(() => f.close());

it("records an off call and supersedes diagnosis with validated local prose", async () => {
  await runModelCalls(f.ctx, diagnosis.runId);
  const latest = f.ctx.db.inferences.list(diagnosis.runId).at(-1);
  expect(latest?.stage === "diagnosis" && latest.value.prose?.source).toBe("template");
  expect(latest?.stage === "diagnosis" && latest.value.prose?.validation.pass).toBe(true);
  expect(latest?.supersedes).toBe(diagnosis.id);
  expect(f.ctx.db.inferences.get(diagnosis.id)?.status).toBe("revised");
  expect(f.ctx.db.egress.list(diagnosis.runId)[0]?.status).toBe("off");
  expect(verifyLog(f.ctx.db).ok).toBe(true);
});

it("rejects invented model numbers and falls back to trace prose", async () => {
  f.ctx.gateway.call = async <T>() => ({ ok: true, value: { sentences: [{ text: "Dead sensor with 987654 failures.", evidenceIds: [evidenceId] }] } as T, recordId: "fake", source: "model" });
  await runModelCalls(f.ctx, diagnosis.runId);
  const latest = f.ctx.db.inferences.list(diagnosis.runId).at(-1);
  expect(latest?.stage === "diagnosis" && latest.value.prose?.source).toBe("template");
  expect(latest?.stage === "diagnosis" && latest.value.prose?.text).not.toContain("987654");
});

it("limits and renormalizes ranked contributions without mutating the diagnosis", () => {
  const input = structuredClone(diagnosis);
  input.value.ranked = Array.from({ length: 30 }, (_, i) => ({ sensor: `S${String(i + 1).padStart(2, "0")}`, contribution: i + 1, onset: null }));
  const payload = explanationPayload(input);
  expect(EgressPayload.safeParse(payload).success).toBe(true);
  expect(payload.ranked).toHaveLength(20);
  expect(payload.ranked[0]?.alias).toBe("S30");
  expect(payload.ranked.reduce((sum, r) => sum + r.contribution, 0)).toBeCloseTo(1);
  expect(payload.excluded).toHaveLength(10);
  expect(input.value.ranked).toHaveLength(30);
});

it("caps naming concurrency at four and preserves deterministic roles", async () => {
  for (let index = 0; index < 9; index++) {
    const alias = `S${String(index + 1).padStart(2, "0")}`;
    f.ctx.db.sensors.saveAll([{ runId: diagnosis.runId, alias, index, sourceName: `private_name_${index}`, fingerprint: { n: 500, missingRate: 0, quantiles: { p1: 0, p5: 1, p25: 2, p50: 3, p75: 4, p95: 5, p99: 6 }, mad: 1, histogram: { edges: [], shares: [1] }, step: 0, hold: 1, noise: 0.1, acfTime: 2, period: null, flatShare: 0, monotonicShare: 0, distinct: 500, signalType: "slow" }, relations: [], redundancyGroup: null, peers: [], flowIndex: index }]);
    createInference(f.ctx.db, { runId: diagnosis.runId, stage: "role", sensor: alias, claim: "Role", confidence: 0.6, evidenceIds: [evidenceId], status: "proposed", supersedes: null, value: { sensor: alias, role: "controlled", scores: { setpoint: 0, controlled: 1, actuator: 0, redundant: 0, upstream: 0, downstream: 0, counter: 0, state: 0, unknown: 0 }, hypothesisName: null, hypothesisConfidence: null } });
  }
  let active = 0;
  let peak = 0;
  f.ctx.gateway.call = async <T>(purpose: string, payload: unknown) => {
    expect(JSON.stringify(payload)).not.toContain("private_name");
    if (purpose !== "name_role") return { ok: false, recordId: null, reason: "offline" };
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active--;
    return { ok: true, value: { name: "Temperature", quantity: "temperature", confidence: 0.4, reason: "Hypothesis" } as T, recordId: "fake", source: "model" };
  };
  await runModelCalls(f.ctx, diagnosis.runId);
  expect(peak).toBe(4);
  const roles = f.ctx.db.inferences.list(diagnosis.runId, "role").filter((i) => i.status !== "revised");
  expect(roles).toHaveLength(9);
  for (const role of roles) {
    expect(role.stage === "role" && role.value.role).toBe("controlled");
    expect(role.stage === "role" && role.value.hypothesisName).toBe("Temperature");
  }
});
