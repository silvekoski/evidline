import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ActionResponse, type DiagnosisInference, type Inference, type RoleInference } from "@tpm/schemas";
import type { PipelineOutput } from "../src/pipeline-worker";
import { appendLog } from "../src/log";
import { addThread, headOf, outcome, overridesOf, threadOf } from "../src/operator";
import { fixture, run, type Fixture } from "./fixture";

const runId = "0123abcd";
const evidenceIds = [`ev-${runId}-00001`];
const base = { runId, claim: "claim", confidence: 0.8, evidenceIds, status: "proposed" as const, supersedes: null };
const scores = { setpoint: 0, controlled: 0.7, actuator: 0.2, redundant: 0, upstream: 0, downstream: 0, counter: 0, state: 0, unknown: 0 };
const role = (id: number, sensor: string, value: RoleInference["value"]["role"], patch: Partial<Inference> = {}): RoleInference =>
  ({ ...base, id: `inf-${runId}-${String(id).padStart(5, "0")}`, seq: id, sensor, stage: "role", value: { sensor, role: value, scores, hypothesisName: null, hypothesisConfidence: null }, ...patch }) as RoleInference;
const ranked = (sensors: string[]) => sensors.map((sensor, i) => ({ sensor, contribution: 1 / (i + 1), onset: 5000 }));
const diagnosis: DiagnosisInference = { ...base, id: `inf-${runId}-00009`, seq: 9, sensor: "S03", stage: "diagnosis", value: { faultClass: "process-step", window: { from: 5000, to: 20000, n: 15000 }, onset: 5000, ranked: ranked(["S03", "S04", "S05"]), excluded: [], trace: [], prose: null, pca: null } };

describe("overridesOf", () => {
  let f: Fixture;
  beforeEach(() => {
    f = fixture();
    f.ctx.db.runs.save(run(runId));
  });
  afterEach(() => f.close());

  it("seeds from the rerun entry, then layers accepts and overrides of the run", () => {
    const entry = (patch: Partial<Parameters<typeof appendLog>[1]>) =>
      appendLog(f.ctx.db, { type: "rerun", actor: "agent", runId, inferenceId: null, evidenceIds: [], egressId: null, before: null, after: null, reason: null, ...patch });
    entry({ after: { name: "demo-stream.csv", parentRunId: "89abcdef", overrides: { roles: { S01: "actuator" }, faultClass: { S07: "sensor-drift-bias" }, baseline: { from: 0, to: 4000, n: 4000 } } } });
    const forced = role(1, "S01", "actuator");
    const accepted = role(2, "S02", "controlled", { status: "accepted" });
    const overridden = role(3, "S03", "upstream", { status: "overridden" });
    f.ctx.db.inferences.saveAll([forced, accepted, overridden, diagnosis]);
    entry({ type: "override", actor: "operator", inferenceId: overridden.id, before: { kind: "role", role: "upstream" }, after: { kind: "role", role: "setpoint" }, reason: "Set by hand." });
    entry({ type: "override", actor: "operator", inferenceId: diagnosis.id, before: null, after: { kind: "faultClass", faultClass: "process-oscillation" }, reason: "It cycles." });
    expect(overridesOf(f.ctx.db, runId)).toEqual({
      roles: { S01: "actuator", S02: "controlled", S03: "setpoint" },
      faultClass: { S07: "sensor-drift-bias", S03: "process-oscillation" },
      baseline: { from: 0, to: 4000, n: 4000 },
    });
  });

  it("is empty for a root run with no operator action", () => {
    f.ctx.db.inferences.saveAll([role(1, "S01", "actuator")]);
    expect(overridesOf(f.ctx.db, runId)).toEqual({});
  });
});

describe("outcome", () => {
  const output = (incidents: DiagnosisInference[]): PipelineOutput => ({ incidents, drifts: [], roles: [] }) as unknown as PipelineOutput;

  it("does not revise a role that the operator forced when test_role restates the natural role", () => {
    const forced = role(1, "S01", "actuator");
    const natural = role(1, "S01", "controlled");
    const result = { text: "", evidenceIds, role: { value: natural.value, claim: "", confidence: 0.5, evidenceIds } };
    expect(outcome(forced, result, 20000, { roles: { S01: "actuator" } })?.changed).toBe(false);
    expect(outcome(forced, result, 20000, {})?.changed).toBe(true);
  });

  it("confirms a diagnosis whose masked lead sensor moved to excluded", () => {
    const rerun: DiagnosisInference = { ...diagnosis, value: { ...diagnosis.value, ranked: ranked(["S04", "S05"]), excluded: ["S03"] } };
    const found = outcome(diagnosis, { text: "", evidenceIds, result: output([rerun]) }, 20000, {});
    expect(found?.changed).toBe(false);
    const shifted: DiagnosisInference = { ...rerun, value: { ...rerun.value, onset: 5300 } };
    expect(outcome(diagnosis, { text: "", evidenceIds, result: output([shifted]) }, 20000, {})?.changed).toBe(true);
    const relabeled: DiagnosisInference = { ...rerun, value: { ...rerun.value, faultClass: "process-degradation" } };
    expect(outcome(diagnosis, { text: "", evidenceIds, result: output([relabeled]) }, 20000, {})?.changed).toBe(true);
  });
});

describe("supersedes chain", () => {
  let f: Fixture;
  beforeEach(() => {
    f = fixture();
    f.ctx.db.runs.save(run(runId));
  });
  afterEach(() => f.close());

  it("collects the entries of the supersedes chain, oldest first", () => {
    const first = role(1, "S01", "controlled", { status: "revised" });
    const second = role(2, "S01", "controlled", { status: "accepted", supersedes: first.id });
    f.ctx.db.inferences.saveAll([first, second]);
    addThread(f.ctx.db, first.id, "question", "Why?");
    addThread(f.ctx.db, first.id, "verdict", "Confirmed.");
    addThread(f.ctx.db, second.id, "accept", "Accepted by the operator.");
    expect(threadOf(f.ctx.db, second).map((t) => [t.inferenceId, t.kind])).toEqual([[first.id, "question"], [first.id, "verdict"], [second.id, "accept"]]);
    expect(threadOf(f.ctx.db, first).map((t) => t.kind)).toEqual(["question", "verdict"]);
  });

  it("applies an operator action with a stale id to the head of the chain in the same run", async () => {
    const first = role(1, "S01", "controlled", { status: "revised" });
    const second = role(2, "S01", "controlled", { supersedes: first.id });
    const child = role(1, "S01", "controlled", { runId: "89abcdef", id: "inf-89abcdef-00001", supersedes: second.id });
    f.ctx.db.inferences.saveAll([first, second, child]);
    expect(headOf(f.ctx.db, first).id).toBe(second.id);
    const res = await f.app.request(`/api/inferences/${first.id}/accept`, { method: "POST" });
    expect(res.status).toBe(200);
    const action = ActionResponse.parse(await res.json());
    expect(action.inference).toMatchObject({ id: second.id, status: "accepted" });
    expect(action.thread.map((t) => [t.inferenceId, t.kind])).toEqual([[second.id, "accept"]]);
    expect(f.ctx.db.inferences.get(first.id)?.status).toBe("revised");
    expect(f.ctx.db.inferences.get(child.id)?.status).toBe("proposed");
  });
});
