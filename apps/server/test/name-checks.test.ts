import { afterEach, beforeEach, expect, it } from "vitest";
import type { EgressRecord, Evidence, RoleInference } from "@tpm/schemas";
import { nameCheckReport } from "../src/name-checks";
import { createInference } from "../src/persist";
import { fixture, run, type Fixture } from "./fixture";

let f: Fixture;
const runId = "0123abcd";
const evidenceId = "ev-0123abcd-00001";

const record = (id: string, inferenceId: string, purpose: "name_role" | "check_name", model: string, response: object): EgressRecord => ({
  id,
  runId,
  time: `2026-09-20T00:0${id.length % 10}:00.000Z`,
  purpose,
  mode: "cloud",
  provider: { name: "openai-compatible", model, region: "EU", host: "api.example.test" },
  payload: "{}",
  payloadBytes: 2,
  guards: [],
  templateHash: "x",
  inferenceId,
  operatorText: false,
  status: "sent",
  response: JSON.stringify(response),
  validator: null,
  durationMs: 10,
});

beforeEach(() => {
  f = fixture();
  f.ctx.db.runs.save(run(runId));
  f.ctx.db.evidence.saveAll([{ id: evidenceId, runId, kind: "residual", sensors: [], window: { from: 0, to: 500, n: 500 }, method: "test", stats: { n: 500 }, verdict: "failed", chart: { type: "line", window: { from: 0, to: 500, n: 500 }, series: [] } } satisfies Evidence]);
});
afterEach(() => f.close());

it("reports the primary name with its reason and each reviewer with its reason", () => {
  const head = createInference(f.ctx.db, {
    runId, stage: "role", sensor: "S01", claim: "Role", confidence: 0.6, evidenceIds: [evidenceId], status: "proposed", supersedes: null,
    value: { sensor: "S01", role: "controlled", scores: { setpoint: 0, controlled: 1, actuator: 0, redundant: 0, upstream: 0, downstream: 0, counter: 0, state: 0, unknown: 0 }, hypothesisName: "Reactor pressure", hypothesisConfidence: 0.4 },
  }) as RoleInference;
  f.ctx.db.egress.save(record("eg-1", head.id, "name_role", "mistralai/Large", { name: "Reactor pressure", quantity: "kPa", confidence: 0.4, reason: "Leads the flow." }));
  f.ctx.db.egress.save(record("eg-22", head.id, "check_name", "deepseek-ai/Flash", { name: "reactor pressure", quantity: "pressure", confidence: 0.5, reason: "Same lag pattern." }));
  f.ctx.db.egress.save(record("eg-333", head.id, "check_name", "moonshotai/Kimi", { name: "Temperature", quantity: "degC", confidence: 0.7, reason: "Slow acf." }));

  const report = nameCheckReport(f.ctx, head);
  expect(report.name).toBe("Reactor pressure");
  expect(report.primary).toMatchObject({ egressId: "eg-1", model: "mistralai/Large", name: "Reactor pressure", agrees: true, reason: "Leads the flow." });
  expect(report.checks.map((c) => [c.model, c.agrees, c.reason])).toEqual([
    ["deepseek-ai/Flash", true, "Same lag pattern."],
    ["moonshotai/Kimi", false, "Slow acf."],
  ]);
});

it("lets the name that most models share win over the primary name", () => {
  const head = createInference(f.ctx.db, {
    runId, stage: "role", sensor: "S01", claim: "Role", confidence: 0.6, evidenceIds: [evidenceId], status: "proposed", supersedes: null,
    value: { sensor: "S01", role: "controlled", scores: { setpoint: 0, controlled: 1, actuator: 0, redundant: 0, upstream: 0, downstream: 0, counter: 0, state: 0, unknown: 0 }, hypothesisName: "Production Cycle Counter", hypothesisConfidence: 0.7 },
  }) as RoleInference;
  f.ctx.db.egress.save(record("eg-1", head.id, "name_role", "mistralai/Large", { name: "Production Cycle Counter", quantity: "count", confidence: 0.7, reason: "Steps." }));
  f.ctx.db.egress.save(record("eg-22", head.id, "check_name", "deepseek-ai/Flash", { name: "Process temperature", quantity: "degC", confidence: 0.6, reason: "Slow acf." }));
  f.ctx.db.egress.save(record("eg-333", head.id, "check_name", "moonshotai/Kimi", { name: "Ambient Temperature", quantity: "°C", confidence: 0.7, reason: "Daily period." }));
  f.ctx.db.egress.save(record("eg-4444", head.id, "check_name", "zai-org/GLM", { name: "Tank level", quantity: "mm", confidence: 0.5, reason: "Bounded." }));

  const report = nameCheckReport(f.ctx, head);
  expect(report.name).toBe("Process temperature");
  expect(report.primary?.agrees).toBe(false);
  expect(report.checks.map((c) => [c.model, c.agrees])).toEqual([
    ["deepseek-ai/Flash", true],
    ["moonshotai/Kimi", true],
    ["zai-org/GLM", false],
  ]);
});

it("reports no primary name when the naming call is off", () => {
  const head = createInference(f.ctx.db, {
    runId, stage: "role", sensor: "S01", claim: "Role", confidence: 0.6, evidenceIds: [evidenceId], status: "proposed", supersedes: null,
    value: { sensor: "S01", role: "controlled", scores: { setpoint: 0, controlled: 1, actuator: 0, redundant: 0, upstream: 0, downstream: 0, counter: 0, state: 0, unknown: 0 }, hypothesisName: null, hypothesisConfidence: null },
  }) as RoleInference;
  f.ctx.db.egress.save({ ...record("eg-1", head.id, "name_role", "", {}), mode: "off", provider: null, status: "off", response: null });
  expect(nameCheckReport(f.ctx, head)).toEqual({ pending: null, name: null, primary: null, checks: [] });
});
