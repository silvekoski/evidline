import { faultFamily, stageNames } from "@tpm/schemas";
import { describe, expect, it } from "vitest";
import { injectFault } from "../src/inject";
import { runPipeline, type PipelineResult } from "../src/pipeline";
import { gaussian, mulberry32 } from "../src/random";
import { createMemorySink, window, type Grid, type MemorySink } from "../src/types";

const N = 20_000;
const EPISODE = 4_000;
const RAMP_AT = 13_000;
const DEAD_AT = 14_000;
const SHIFT_AT = 16_000;
const LAGS = [0, 3, 6, 10, 14, 18];
const GAINS = [1, 0.8, 0.6, 1.2, 0.9, 0.7];
const OFFSETS = [10, 20, 30, 40, 50, 60];
const SHIFT = [5, 12, -6, 11, -7, 10];

function ar1(n: number, phi: number, rng: () => number): Float64Array {
  const out = new Float64Array(n);
  for (let t = 1; t < n; t++) out[t] = phi * out[t - 1]! + gaussian(rng);
  return out;
}

function group(rng: () => number, base: number): Float64Array[] {
  const driver = ar1(N + 20, 0.9, rng);
  return LAGS.map((lag, i) => Float64Array.from({ length: N }, (_, t) => base + OFFSETS[i]! + GAINS[i]! * driver[t + 20 - lag]! + gaussian(rng)));
}

function makeGrid(seed = 1): Grid {
  const rng = mulberry32(seed);
  const values = [...group(rng, 0), ...group(rng, 100)];
  values[2] = injectFault(values[2]!, { kind: "bias", from: RAMP_AT, magnitude: 8 }, rng);
  values[4] = injectFault(values[4]!, { kind: "dead", from: DEAD_AT, magnitude: 0 }, rng);
  SHIFT.forEach((by, i) => {
    const x = values[6 + i]!;
    for (let t = SHIFT_AT; t < N; t++) x[t] = x[t]! + by;
  });
  return {
    aliases: values.map((_, i) => `S${String(i + 1).padStart(2, "0")}`),
    values,
    n: N,
    dt: null,
    time: null,
    episodes: Array.from({ length: N / EPISODE }, (_, k) => window(k * EPISODE, (k + 1) * EPISODE)),
  };
}

type Claim = { claim: string; confidence: number; evidenceIds: string[] };

function inferences(result: PipelineResult): Claim[] {
  return [
    result.baseline,
    result.healthCalibration,
    ...result.health,
    ...result.rules,
    ...result.roles,
    result.driftCalibration,
    ...result.drifts,
    ...result.incidents,
  ];
}

describe("runPipeline on a seeded synthetic plant", () => {
  const sink = createMemorySink("0123abcd");
  const stages: string[] = [];
  const started = performance.now();
  const result = runPipeline(makeGrid(), sink, { onStage: (name) => stages.push(name) });
  const elapsed = performance.now() - started;
  const byId = new Map(sink.evidence.map((e) => [e.id, e]));
  const incidentOf = (sensor: string) => result.incidents.find((i) => i.value.ranked.some((r) => r.sensor === sensor) || i.value.excluded.includes(sensor))!;

  it("finishes under 20 s and reports the ten stages in order with timings", () => {
    expect(elapsed).toBeLessThan(20_000);
    expect(stages).toEqual(stageNames.slice(1, 11));
    expect(result.stages.map((s) => s.name)).toEqual(stages);
    for (const s of result.stages) {
      expect(s.ms).toBeGreaterThanOrEqual(0);
      expect(Object.values(s.counts).every(Number.isFinite)).toBe(true);
    }
    expect(result.stages.find((s) => s.name === "Fault separation")!.counts.incidents).toBe(result.incidents.length);
  });

  it("selects the first 60% as the baseline and merges the calibrated thresholds", () => {
    expect(result.baseline.value.window).toEqual(window(0, 12_000));
    expect(result.thresholds).toEqual({ ...result.healthCalibration.value.thresholds, ...result.driftCalibration.thresholds });
    expect(result.driftCalibration.value.thresholds).toEqual(result.thresholds);
    expect([5, 10, 20, 50, 100, 200]).toContain(result.thresholds.cusumH);
  });

  it("calls the dead sensor sensor-dead and masks it", () => {
    const dead = result.health.find((h) => h.value.sensor === "S05")!;
    expect(dead.value.health).toBe("dead");
    expect(dead.value.masked[0]!.from).toBeGreaterThanOrEqual(DEAD_AT - 320);
    expect(dead.value.masked[0]!.from).toBeLessThanOrEqual(DEAD_AT);
    expect(result.health.filter((h) => h.value.health !== "healthy").map((h) => h.value.sensor)).toEqual(["S05"]);
    expect(result.masks[4]![N - 1]).toBe(1);
    const incident = incidentOf("S05");
    expect(incident.value.faultClass).toBe("sensor-dead");
    expect(incident.value.ranked).toEqual([]);
    expect(incident.confidence).toBe(1);
  });

  it("calls the ramp sensor-drift-bias with the ramped sensor responsible and ranked first", () => {
    const drift = result.drifts.find((d) => d.value.sensor === "S03")!;
    expect(drift.value.drifting).toBe(true);
    expect(drift.value.responsible).toBe("S03");
    expect(drift.value.onset).toBeGreaterThanOrEqual(RAMP_AT);
    expect(drift.value.onset).toBeLessThan(SHIFT_AT);
    expect(drift.value.detectionDelay).toBeGreaterThanOrEqual(0);
    const incident = incidentOf("S03");
    expect(incident.value.faultClass).toBe("sensor-drift-bias");
    expect(incident.value.ranked[0]!.sensor).toBe("S03");
    expect(incident.value.ranked.map((r) => r.sensor)).not.toContain("S05");
    expect(incident.value.excluded).toEqual(["S05"]);
    expect(incident.value.onset).toBe(drift.value.onset);
    expect(incident.value.trace[0]!.result).toContain("S05 (dead)");
  });

  it("calls the shifted driver group a process fault with the group ranked", () => {
    const incident = incidentOf("S09");
    expect(faultFamily(incident.value.faultClass)).toBe("process");
    expect(incident.value.onset).toBeGreaterThanOrEqual(SHIFT_AT);
    expect(incident.value.onset).toBeLessThanOrEqual(SHIFT_AT + 200);
    const ranked = incident.value.ranked.map((r) => r.sensor);
    expect(ranked.length).toBeGreaterThanOrEqual(4);
    for (const sensor of ranked) expect(["S07", "S08", "S09", "S10", "S11", "S12"]).toContain(sensor);
    expect(result.incidents).toHaveLength(3);
  });

  it("cites evidence that exists for every inference and keeps every trace stat in its cited evidence", () => {
    for (const inference of inferences(result)) {
      expect(inference.evidenceIds.length).toBeGreaterThan(0);
      for (const id of inference.evidenceIds) expect(byId.has(id), `${id} exists`).toBe(true);
      expect(inference.confidence).toBeGreaterThanOrEqual(0);
      expect(inference.confidence).toBeLessThanOrEqual(1);
      expect(inference.claim.length).toBeGreaterThan(0);
    }
    for (const e of sink.evidence) for (const v of Object.values(e.stats)) expect(Number.isFinite(v)).toBe(true);
    for (const incident of result.incidents) {
      expect(incident.value.trace.map((s) => s.test)).toEqual(["health", "drift", "isolation", "propagation", "control-loop", "verdict"]);
      for (const step of incident.value.trace) {
        expect(step.evidenceIds.length).toBeGreaterThan(0);
        for (const id of step.evidenceIds) expect(byId.has(id), `${id} exists`).toBe(true);
        for (const [key, value] of Object.entries(step.stats)) {
          expect(step.evidenceIds.some((id) => byId.get(id)!.stats[key] === value), `${step.test}.${key}`).toBe(true);
        }
      }
    }
  });

  it("gives ranked contributions that sum to 1", () => {
    for (const incident of result.incidents) {
      if (incident.value.ranked.length === 0) continue;
      expect(incident.value.ranked.reduce((s, r) => s + r.contribution, 0)).toBeCloseTo(1, 9);
      for (const r of incident.value.ranked) expect(r.contribution).toBeGreaterThan(0);
    }
  });

  it("is deterministic for the same seed", { timeout: 20_000 }, () => {
    const again: MemorySink = createMemorySink("0123abcd");
    const repeat = runPipeline(makeGrid(), again);
    expect(repeat.incidents.map((i) => [i.value.faultClass, i.value.onset, i.value.ranked.map((r) => r.sensor)])).toEqual(
      result.incidents.map((i) => [i.value.faultClass, i.value.onset, i.value.ranked.map((r) => r.sensor)]),
    );
    expect(again.evidence.length).toBe(sink.evidence.length);
  });
});

describe("runPipeline with overrides", () => {
  it("applies the baseline, role, mask, responsible and fault class overrides at their stages", { timeout: 20_000 }, () => {
    const sink = createMemorySink("0123abcd");
    const result = runPipeline(makeGrid(), sink, {
      overrides: {
        baseline: window(0, 10_000),
        roles: { S02: "setpoint" },
        masked: ["S06"],
        responsible: { S03: "S02" },
        faultClass: { S07: "process-oscillation", S08: "process-oscillation", S09: "process-oscillation", S10: "process-oscillation", S11: "process-oscillation", S12: "process-oscillation" },
      },
    });
    expect(result.baseline.value.window).toEqual(window(0, 10_000));
    expect(result.baseline.claim).toContain("operator");
    expect(result.roles.find((r) => r.value.sensor === "S02")!.value.role).toBe("setpoint");
    expect(result.masks[5]!.every((v) => v === 1)).toBe(true);
    expect(result.drifts.find((d) => d.value.sensor === "S06")).toBeUndefined();
    expect(result.drifts.find((d) => d.value.sensor === "S03")!.value.responsible).toBe("S02");
    for (const incident of result.incidents) if (incident.value.ranked.length > 0) expect(incident.value.excluded).toContain("S06");
    const process = result.incidents.find((i) => i.value.ranked.some((r) => r.sensor === "S09"))!;
    expect(process.value.faultClass).toBe("process-oscillation");
    expect(process.value.trace[5]!.result).toContain("operator");
  });
});
