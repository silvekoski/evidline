import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { gaussian, injectFault, minBaselineLength, mulberry32 } from "@tpm/core";
import {
  ActionResponse,
  CompileRuleResult,
  DriftReport,
  Evidence,
  EvidenceSeries,
  IncidentReport,
  LogEntry,
  QualityReport,
  Rule,
  Run,
  RunList,
  SensorDetail,
  SensorReport,
  ThreadEntry,
  type Role,
} from "@tpm/schemas";
import { fixture, run as runRow, type Fixture } from "./fixture";

const N = 6000;
const DEAD_AT = 4000;
const RAMP_AT = 4500;
const LAGS = [0, 3, 6, 10, 14, 18];
const GAINS = [1, 0.8, 0.6, 1.2, 0.9, 0.7];
const OFFSETS = [10, 20, 30, 40, 50, 60];
const T0 = Date.parse("2026-01-01T00:00:00Z");

function ar1(n: number, phi: number, rng: () => number): Float64Array {
  const out = new Float64Array(n);
  for (let t = 1; t < n; t++) out[t] = phi * out[t - 1]! + gaussian(rng);
  return out;
}

function group(rng: () => number, base: number): Float64Array[] {
  const driver = ar1(N + 20, 0.9, rng);
  return LAGS.map((lag, i) => Float64Array.from({ length: N }, (_, t) => base + OFFSETS[i]! + GAINS[i]! * driver[t + 20 - lag]! + gaussian(rng)));
}

function writePlantCsv(dir: string): void {
  const rng = mulberry32(7);
  const values = [...group(rng, 0), ...group(rng, 100)];
  values[4] = injectFault(values[4]!, { kind: "dead", from: DEAD_AT, magnitude: 0 }, rng);
  values[2] = injectFault(values[2]!, { kind: "bias", from: RAMP_AT, magnitude: 8 }, rng);
  const header = ["time", ...values.map((_, i) => `probe_${String(i + 1).padStart(2, "0")}`)];
  const lines = Array.from({ length: N }, (_, t) => [new Date(T0 + t * 60_000).toISOString(), ...values.map((x) => x[t]!.toFixed(4))].join(","));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "plant.csv"), [header.join(","), ...lines].join("\n") + "\n");
}

const json = (f: Fixture, path: string, body?: unknown) =>
  f.app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? null : JSON.stringify(body) });

async function get<T>(f: Fixture, path: string, schema: { parse(input: unknown): T }): Promise<T> {
  const res = await f.app.request(path);
  expect(res.status, path).toBe(200);
  return schema.parse(await res.json());
}

async function waitForRun(f: Fixture, id: string): Promise<Run> {
  for (let i = 0; i < 1200; i++) {
    const run = await get(f, `/api/runs/${id}`, Run);
    if (run.status === "done" || run.status === "failed") return run;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`run ${id} did not finish`);
}

describe("api routes on a synthetic plant", () => {
  let f: Fixture;
  let run: Run;

  beforeAll(async () => {
    f = fixture();
    writePlantCsv(f.ctx.dataDir);
    const res = await json(f, "/api/runs", { path: "plant.csv" });
    expect(res.status).toBe(201);
    const { runId } = (await res.json()) as { runId: string };
    expect(runId).toMatch(/^[0-9a-f]{8}$/);
    run = await waitForRun(f, runId);
  }, 120_000);
  afterAll(() => f.close());

  it("rejects a path outside data/ and a missing file", async () => {
    expect((await json(f, "/api/runs", { path: "../plant.csv" })).status).toBe(400);
    expect((await json(f, "/api/runs", { path: "nope.csv" })).status).toBe(400);
    expect((await json(f, "/api/runs", {})).status).toBe(400);
  });

  it("finishes every stage and lists the run newest first", async () => {
    expect(run.status, run.error ?? "").toBe("done");
    expect(run.name).toBe("plant.csv");
    expect(run.sensorCount).toBe(12);
    expect(run.gridSize).toBe(N);
    expect(run.timeBase.dt).toBe(60_000);
    expect(run.stages.map((s) => s.status)).toEqual(Array(12).fill("done"));
    for (const s of run.stages) expect(s.ms).toBeGreaterThanOrEqual(0);
    expect(run.finishedAt).not.toBeNull();
    const list = await get(f, "/api/runs", RunList);
    expect(list[0]?.id).toBe(run.id);
    expect((await f.app.request("/api/runs/00000000")).status).toBe(404);
  });

  it("replays the final run and done on the event stream", async () => {
    const res = await f.app.request(`/api/runs/${run.id}/events`);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text();
    expect(text).toContain('"type":"run"');
    expect(text.endsWith(`data: {"type":"done","runId":"${run.id}"}\n\n`)).toBe(true);
  });

  it("serves the sensor report and the sensor detail with its evidence", async () => {
    const report = await get(f, `/api/runs/${run.id}/sensors`, SensorReport);
    expect(report.sensors.map((s) => s.alias)).toEqual(Array.from({ length: 12 }, (_, i) => `S${String(i + 1).padStart(2, "0")}`));
    expect(report.sensors[0]?.sourceName).toBe("probe_01");
    expect(report.sensors.find((s) => s.alias === "S05")?.health).toBe("dead");
    expect(report.sensors.every((s) => s.status === "proposed")).toBe(true);
    const detail = await get(f, `/api/runs/${run.id}/sensors/S03`, SensorDetail);
    expect(detail.fingerprint.n).toBe(N);
    expect(detail.evidenceIds.length).toBeGreaterThan(0);
    for (const id of detail.evidenceIds) expect(f.ctx.db.evidence.get(id), id).not.toBeNull();
    expect(detail.relations.every((r) => r.a === "S03" || r.b === "S03")).toBe(true);
    expect((await f.app.request(`/api/runs/${run.id}/sensors/S99`)).status).toBe(404);
  });

  it("serves quality, drift and incidents with a dead sensor incident", async () => {
    const quality = await get(f, `/api/runs/${run.id}/quality`, QualityReport);
    expect(quality.baseline.value.window.n).toBeGreaterThanOrEqual(minBaselineLength(N));
    expect(quality.calibration).toHaveLength(2);
    expect(quality.checks).toHaveLength(12);
    expect(quality.rules.length).toBeGreaterThan(0);
    const drift = await get(f, `/api/runs/${run.id}/drift`, DriftReport);
    const severities = drift.drifts.map((d) => d.value.severity);
    expect(severities).toEqual([...severities].sort((a, b) => b - a));
    const incidents = await get(f, `/api/runs/${run.id}/incidents`, IncidentReport);
    const dead = incidents.incidents.find((i) => i.value.faultClass === "sensor-dead");
    expect(dead?.value.excluded).toContain("S05");
    expect(dead?.value.prose?.source).toBe("template");
    const onsets = incidents.incidents.map((i) => i.value.onset ?? N);
    expect(onsets).toEqual([...onsets].sort((a, b) => a - b));
  });

  it("serves evidence and its downsampled series keyed by the chart series", async () => {
    const residual = f.ctx.db.evidence.list(run.id).find((e) => e.kind === "residual");
    expect(residual).toBeDefined();
    const evidence = await get(f, `/api/evidence/${residual!.id}`, Evidence);
    expect(evidence.chart.secondary?.[0]?.key).toBe("deviation");
    const series = await get(f, `/api/evidence/${residual!.id}/series`, EvidenceSeries);
    expect(series.t.length).toBeGreaterThan(0);
    expect(series.t.length).toBeLessThanOrEqual(2000);
    expect(series.t[0]).toBe(evidence.window.from);
    for (const key of ["value", "expected", "deviation"]) expect(series.series[key], key).toHaveLength(series.t.length);
    expect((await f.app.request("/api/evidence/ev-00000000-00001")).status).toBe(404);
  });

  it("accepts an inference and logs it", async () => {
    const health = f.ctx.db.inferences.list(run.id, "health").find((i) => i.sensor === "S01")!;
    const res = await json(f, `/api/inferences/${health.id}/accept`);
    expect(res.status).toBe(200);
    const action = ActionResponse.parse(await res.json());
    expect(action.inference.status).toBe("accepted");
    expect(action.thread.map((t) => t.kind)).toEqual(["accept"]);
    expect(f.ctx.db.inferences.get(health.id)?.status).toBe("accepted");
    const log = await get(f, `/api/log?runId=${run.id}`, { parse: (x: unknown) => (x as unknown[]).map((e) => LogEntry.parse(e)) });
    expect(log.at(-1)).toMatchObject({ type: "accept", actor: "operator", inferenceId: health.id, after: "accepted" });
    expect(await get(f, `/api/inferences/${health.id}/thread`, { parse: (x: unknown) => (x as unknown[]).map((e) => ThreadEntry.parse(e)) })).toHaveLength(1);
  });

  it("answers a question in mode off with a plan, results and a verdict", async () => {
    const role = f.ctx.db.inferences.list(run.id, "role").find((i) => i.sensor === "S03")!;
    const res = await json(f, `/api/inferences/${role.id}/question`, { text: "Is S03 really in this role? Compare the windows." });
    expect(res.status).toBe(200);
    const action = ActionResponse.parse(await res.json());
    const kinds = action.thread.map((t) => t.kind);
    expect(kinds.slice(0, 2)).toEqual(["question", "plan"]);
    expect(kinds.filter((k) => k === "result")).toHaveLength(2);
    expect(kinds.at(-1)).toBe("verdict");
    expect(action.thread[1]?.egressId).toMatch(/^eg-/);
    const results = action.thread.filter((t) => t.kind === "result");
    for (const entry of results) {
      expect(entry.evidenceIds.length).toBeGreaterThan(0);
      for (const id of entry.evidenceIds) expect(f.ctx.db.evidence.get(id), id).not.toBeNull();
    }
    expect(["accepted", "revised"]).toContain(action.inference.status);
    expect(f.ctx.db.egress.list(run.id).find((r) => r.purpose === "plan_investigation")).toMatchObject({ status: "off", operatorText: true });
  }, 60_000);

  it("keeps the inference questioned with a verdict when every tool call fails", async () => {
    const health = f.ctx.db.inferences.list(run.id, "health").find((i) => i.sensor === "S02")!;
    const original = f.ctx.gateway.call;
    f.ctx.gateway.call = async <T>() => ({ ok: true as const, value: { calls: [{ tool: "rerun_without", sensor: "S99" }], rationale: "Mask a sensor the run does not have." } as T, recordId: "eg-fake", source: "model" as const });
    try {
      const res = await json(f, `/api/inferences/${health.id}/question`, { text: "Mask S99." });
      expect(res.status).toBe(200);
      const action = ActionResponse.parse(await res.json());
      expect(action.inference.status).toBe("questioned");
      expect(action.changed).toEqual([]);
      expect(action.thread.map((t) => t.kind)).toEqual(["question", "plan", "result", "verdict"]);
      expect(action.thread[2]?.text).toBe("rerun_without S99 failed: Unknown sensor S99");
      expect(action.thread[3]?.text).toContain("failed");
    } finally {
      f.ctx.gateway.call = original;
    }
  });

  it("rejects model calls on a run that is not done", async () => {
    f.ctx.db.runs.save(runRow("aaaa0009", { status: "running", finishedAt: null }));
    const res = await json(f, "/api/runs/aaaa0009/model-calls");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "run aaaa0009 is running" });
  });

  it("overrides a role, reruns as a child run and reports what changed", async () => {
    const role = f.ctx.db.inferences.list(run.id, "role").find((i) => i.sensor === "S01" && i.status === "proposed")!;
    const current = role.stage === "role" ? role.value.role : "unknown";
    const target: Role = current === "actuator" ? "controlled" : "actuator";
    const res = await json(f, `/api/inferences/${role.id}/override`, { value: { kind: "role", role: target }, reason: "The valve position is logged here." });
    expect(res.status).toBe(200);
    const action = ActionResponse.parse(await res.json());
    expect(action.inference.status).toBe("overridden");
    expect(action.thread.map((t) => t.kind)).toEqual(["override"]);
    expect(action.rerunId).toMatch(/^[0-9a-f]{8}$/);
    const child = await get(f, `/api/runs/${action.rerunId}`, Run);
    expect(child.parentRunId).toBe(run.id);
    expect(child.status).toBe("done");
    const pair = action.changed.find((p) => p.before.id === role.id);
    expect(pair?.after.stage === "role" && pair.after.value.role).toBe(target);
    expect(pair?.after.supersedes).toBe(role.id);
    expect(pair?.after.runId).toBe(child.id);
    const sensors = await get(f, `/api/runs/${child.id}/sensors`, SensorReport);
    expect(sensors.sensors.find((s) => s.alias === "S01")).toMatchObject({ role: target, status: "proposed" });
    expect(sensors.sensors.find((s) => s.alias === "S01")?.notes[0]).toContain("The valve position is logged here.");
    expect((await json(f, `/api/inferences/${role.id}/override`, { value: { kind: "baseline", window: { from: 0, to: 10, n: 10 } }, reason: "x" })).status).toBe(400);
    const asked = await json(f, `/api/inferences/${pair!.after.id}/question`, { text: "Is S01 really in this role?" });
    expect(asked.status).toBe(200);
    const answer = ActionResponse.parse(await asked.json());
    expect(answer.inference.status).toBe("accepted");
    expect(answer.inference.stage === "role" && answer.inference.value.role).toBe(target);
    expect(answer.changed).toEqual([]);
    expect(answer.thread.at(-1)?.text).toContain("Confirmed");
  }, 120_000);

  it("compiles an operator rule, rejects an unknown alias and activates the rule", async () => {
    const res = await json(f, "/api/rules/compile", { runId: run.id, sentence: "S02 must stay below 1000" });
    expect(res.status).toBe(201);
    const compiled = CompileRuleResult.parse(await res.json());
    expect(compiled.rule).toMatchObject({ runId: run.id, origin: "operator", active: false, restated: "S02 must stay below 1000" });
    expect(compiled.rule.rule).toMatchObject({ type: "range", sensor: "S02", max: 1000 });
    expect(compiled.rule.violations).toBeGreaterThanOrEqual(0);
    expect(compiled.egressId).toMatch(/^eg-/);
    expect(f.ctx.db.evidence.get(compiled.rule.evidenceId)?.stats.violations).toBe(compiled.rule.violations);
    expect(f.ctx.db.inferences.get(compiled.rule.inferenceId)?.stage).toBe("rule");
    const unknown = await json(f, "/api/rules/compile", { runId: run.id, sentence: "S99 must stay below 5" });
    expect(unknown.status).toBe(422);
    expect(await unknown.json()).toEqual({ error: "Unknown sensor S99" });
    expect((await json(f, "/api/rules/compile", { runId: run.id, sentence: "keep it cool" })).status).toBe(422);
    const activated = await json(f, `/api/rules/${compiled.rule.id}/activate`);
    expect(Rule.parse(await activated.json()).active).toBe(true);
    const quality = await get(f, `/api/runs/${run.id}/quality`, QualityReport);
    expect(quality.rules.find((r) => r.id === compiled.rule.id)?.active).toBe(true);
  });

  it("keeps the log chain valid", async () => {
    expect(await (await f.app.request("/api/log/verify")).json()).toMatchObject({ ok: true });
  });
});
