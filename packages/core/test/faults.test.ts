import type { Fingerprint, HealthValue, Relation, Role, Thresholds, TraceTest } from "@tpm/schemas";
import { describe, expect, it } from "vitest";
import type { DriftResult } from "../src/drift";
import { separateFaults, type FaultContext, type Incident } from "../src/faults";
import { fitPca, pcaStatistics } from "../src/pca";
import { gaussian, mulberry32 } from "../src/random";
import type { RelationGraph } from "../src/relations";
import type { RoleResult } from "../src/roles";
import { TRACE_TESTS, buildTrace, type StepSpec } from "../src/trace";
import { createMemorySink, window, type Grid, type MemorySink } from "../src/types";

const N = 2000;
const BASELINE = window(0, 1000);
const ONSET = 1000;

const thresholds: Thresholds = {
  cusumH: 20,
  cusumK: 0.5,
  deviationLimit: 3,
  distributionLimit: 20,
  deadRunFactor: 5,
  stuckNoiseRatio: 0.1,
  spikeSigma: 5,
  noisyRatio: 3,
  dropoutRateFactor: 5,
  saturationShare: 0.05,
  redundancyRho: 0.95,
  relationRho: 0.3,
};

function fp(over: Partial<Fingerprint> = {}): Fingerprint {
  return {
    n: N,
    missingRate: 0,
    quantiles: { p1: -2, p5: -1.5, p25: -0.5, p50: 0, p75: 0.5, p95: 1.5, p99: 2 },
    mad: 1,
    histogram: { edges: [], shares: [] },
    step: 0.001,
    hold: 1,
    noise: 0.1,
    acfTime: 5,
    period: null,
    flatShare: 0,
    monotonicShare: 0,
    distinct: N,
    signalType: "slow",
    ...over,
  };
}

function makeGrid(count: number, seed = 1): Grid {
  const rng = mulberry32(seed);
  const factor = Float64Array.from({ length: N }, (_, t) => Math.sin(t / 40) + 0.3 * gaussian(rng));
  const values = Array.from({ length: count }, (_, i) =>
    Float64Array.from(factor, (f) => (1 + 0.3 * i) * f + 10 * (i + 1) + 0.2 * gaussian(rng)),
  );
  return { aliases: values.map((_, i) => `S${String(i + 1).padStart(2, "0")}`), values, n: N, dt: null, time: null, episodes: [window(0, N)] };
}

function ramp(from: number, to = 6, seed = 7): Float64Array {
  const rng = mulberry32(seed);
  return Float64Array.from({ length: N }, (_, t) => (t < from ? 0.1 * gaussian(rng) : (to * (t - from)) / (N - from)));
}

function relation(a: string, b: string, lag = 0, rho = 0.8): Relation {
  return { a, b, rho, lag, rhoAtLag: lag === 0 ? rho : rho + 0.05, evidenceId: "ev-00000000-00001" };
}

function graphOf(relations: Relation[], groups: RelationGraph["groups"] = []): RelationGraph {
  const peers = new Map<string, { alias: string; lag: number; rho: number; n: number }[]>();
  for (const r of relations) {
    peers.set(r.a, [...(peers.get(r.a) ?? []), { alias: r.b, lag: -r.lag, rho: r.rho, n: 1000 }]);
    peers.set(r.b, [...(peers.get(r.b) ?? []), { alias: r.a, lag: r.lag, rho: r.rho, n: 1000 }]);
  }
  return { relations, groups, flowOrder: [], peers };
}

const allRoles: Role[] = ["setpoint", "controlled", "actuator", "redundant", "upstream", "downstream", "counter", "state", "unknown"];

function roleOf(sensor: string, role: Role = "unknown"): RoleResult {
  const scores = Object.fromEntries(allRoles.map((r) => [r, r === role ? 1 : 0])) as Record<Role, number>;
  return { value: { sensor, role, scores, hypothesisName: null, hypothesisConfidence: null }, claim: "", confidence: 1, evidenceIds: ["ev-00000000-00001"] };
}

type DriftSpec = {
  onset?: number | null;
  victimOf?: string | null;
  deviation?: Float64Array;
  expected?: Float64Array;
  maxDeviation?: number;
  drifting?: boolean;
  evidenceIds?: string[];
};

function driftOf(sensor: string, grid: Grid, spec: DriftSpec = {}): DriftResult {
  const deviation = spec.deviation ?? ramp(ONSET);
  const expected = spec.expected ?? grid.values[grid.aliases.indexOf(sensor)]!;
  const onset = spec.onset === undefined ? ONSET : spec.onset;
  return {
    value: {
      sensor,
      method: "peer-residual",
      peers: [],
      onset,
      ratePer1000: 1,
      mannKendallZ: 5,
      pValue: 0.0001,
      severity: (spec.maxDeviation ?? 6) / 3,
      maxDeviation: spec.maxDeviation ?? 6,
      drifting: spec.drifting ?? true,
      inRange: true,
      responsible: spec.victimOf ? null : sensor,
      detectionDelay: 10,
    },
    claim: "",
    confidence: 1,
    evidenceIds: spec.evidenceIds ?? [],
    model: { coef: [], intercept: 0, sigma: 1, n: 1000, sensor, peers: [], expected, deviation, predict: () => ({ expected, deviation }) },
    drifting: spec.drifting ?? true,
    victimOf: spec.victimOf ?? null,
  };
}

type Scenario = { ctx: FaultContext; sink: MemorySink };

function scenario(
  grid: Grid,
  over: {
    graph?: RelationGraph;
    drifts?: (sink: MemorySink) => DriftResult[];
    health?: (sink: MemorySink) => Partial<Record<string, HealthValue>>;
    roles?: RoleResult[];
    changepoints?: Map<string, number[]>;
  } = {},
): Scenario {
  const sink = createMemorySink("0123abcd");
  const overrides = over.health?.(sink) ?? {};
  const masks = grid.aliases.map(() => new Uint8Array(N));
  const health = grid.aliases.map((sensor, i) => {
    const value = overrides[sensor] ?? { sensor, health: "healthy" as const, masked: [], checks: [] };
    for (const w of value.masked) masks[i]!.fill(1, w.from, w.to);
    const id = sink.add({
      kind: "health",
      sensors: [sensor],
      window: window(0, N),
      method: "health",
      stats: { n: N, upstream: 1 },
      verdict: "",
      chart: { type: "line", window: window(0, N), series: [] },
    });
    return { value, claim: "", confidence: 1, evidenceIds: [id], mask: masks[i]! };
  });
  const ctx: FaultContext = {
    grid,
    masks,
    fps: grid.aliases.map(() => fp()),
    baseline: BASELINE,
    health,
    graph: over.graph ?? graphOf([]),
    roles: over.roles ?? grid.aliases.map((a) => roleOf(a)),
    drifts: over.drifts?.(sink) ?? [],
    thresholds,
    changepoints: over.changepoints ?? new Map(),
  };
  return { ctx, sink };
}

function checkTrace(incident: Incident, sink: MemorySink): void {
  const byId = new Map(sink.evidence.map((e) => [e.id, e]));
  const { trace } = incident.value;
  expect(trace.map((s) => s.test)).toEqual(TRACE_TESTS);
  expect(trace.map((s) => s.index)).toEqual([0, 1, 2, 3, 4, 5]);
  for (const step of trace) {
    expect(step.evidenceIds.length).toBeGreaterThan(0);
    expect(step.n).toBeGreaterThanOrEqual(100);
    expect(step.result.length).toBeLessThanOrEqual(300);
    for (const id of step.evidenceIds) expect(byId.has(id), `evidence ${id} exists`).toBe(true);
    for (const [key, value] of Object.entries(step.stats)) {
      expect(Number.isFinite(value)).toBe(true);
      expect(
        step.evidenceIds.some((id) => byId.get(id)!.stats[key] === value),
        `${step.test}.${key} exists in cited evidence`,
      ).toBe(true);
    }
  }
  for (const id of incident.evidenceIds) expect(byId.has(id)).toBe(true);
  for (const e of sink.evidence) for (const v of Object.values(e.stats)) expect(Number.isFinite(v)).toBe(true);
}

function contributionSum(incident: Incident): number {
  return incident.value.ranked.reduce((s, r) => s + r.contribution, 0);
}

describe("separateFaults", () => {
  it("turns a health failure into one sensor incident with the health class", () => {
    const grid = makeGrid(4);
    const { ctx, sink } = scenario(grid, {
      health: () => ({
        S02: {
          sensor: "S02",
          health: "dead",
          masked: [window(1200, N)],
          checks: [{ check: "dead", pass: false, statistic: 800, threshold: 40 }],
        },
      }),
    });
    const incidents = separateFaults(ctx, sink);
    expect(incidents).toHaveLength(1);
    const [incident] = incidents;
    expect(incident!.value.faultClass).toBe("sensor-dead");
    expect(incident!.value.excluded).toEqual(["S02"]);
    expect(incident!.value.ranked).toEqual([]);
    expect(incident!.value.onset).toBe(1200);
    expect(incident!.value.window).toEqual(window(1200, N));
    expect(incident!.confidence).toBe(1);
    expect(incident!.claim).toContain("Sensor fault: dead");
    expect(incident!.value.trace[0]!.result).toContain("(dead): S02");
    expect(incident!.value.trace[0]!.stats.statistic).toBe(800);
    expect(incident!.value.trace[0]!.evidenceIds).toContain(ctx.health[1]!.evidenceIds[0]);
    checkTrace(incident!, sink);
  });

  it("calls a bias-like single driver sensor-drift-bias with a valid six-step trace", () => {
    const grid = makeGrid(4);
    const clean = grid.values[0]!.slice();
    grid.values[0]!.set(ramp(ONSET, 4).map((v, t) => v + clean[t]!));
    const { ctx, sink } = scenario(grid, {
      graph: graphOf([relation("S01", "S02"), relation("S01", "S03"), relation("S02", "S03"), relation("S02", "S04")]),
      drifts: (s) => {
        const id = s.add({
          kind: "residual",
          sensors: ["S01"],
          window: window(0, N),
          method: "huber-regression",
          stats: { n: 1000, maxDeviation: 6 },
          verdict: "",
          chart: { type: "line", window: window(0, N), series: [] },
        });
        return [driftOf("S01", grid, { evidenceIds: [id], expected: clean }), driftOf("S02", grid, { victimOf: "S01", maxDeviation: 3.5 })];
      },
    });
    const incidents = separateFaults(ctx, sink);
    expect(incidents).toHaveLength(1);
    const [incident] = incidents;
    expect(incident!.value.faultClass).toBe("sensor-drift-bias");
    expect(incident!.value.onset).toBe(ONSET);
    expect(incident!.value.window).toEqual(window(ONSET, N));
    expect(incident!.value.ranked.map((r) => r.sensor)).toEqual(["S01", "S02"]);
    expect(incident!.value.ranked[0]!.contribution).toBeGreaterThan(0.5);
    expect(contributionSum(incident!)).toBeCloseTo(1, 9);
    expect(incident!.value.excluded).toEqual([]);
    expect(incident!.value.pca).not.toBeNull();
    expect(incident!.value.pca!.spe).toBeGreaterThan(incident!.value.pca!.speLimit);
    expect(incident!.confidence).toBeGreaterThan(0);
    expect(incident!.confidence).toBeLessThanOrEqual(1);
    expect(incident!.value.trace[1]!.evidenceIds).toContain(ctx.drifts[0]!.evidenceIds[0]);
    expect(incident!.value.trace[5]!.result).toContain("Sensor fault: drift (bias)");
    expect(incident!.value.trace[2]!.stats.levelRho).toBeLessThan(0.5);
    checkTrace(incident!, sink);
  });

  it("calls a level-dependent deviation sensor-drift-gain", () => {
    const grid = makeGrid(4);
    const expected = grid.values[0]!;
    const deviation = Float64Array.from(expected, (e, t) => (t < ONSET ? 0 : (3 * e) / 10));
    const { ctx, sink } = scenario(grid, {
      graph: graphOf([relation("S01", "S02"), relation("S01", "S03"), relation("S02", "S03")]),
      drifts: () => [driftOf("S01", grid, { deviation, expected })],
    });
    const [incident] = separateFaults(ctx, sink);
    expect(incident!.value.faultClass).toBe("sensor-drift-gain");
    expect(incident!.value.trace[2]!.stats.levelRho).toBeGreaterThan(0.5);
    expect(contributionSum(incident!)).toBeCloseTo(1, 9);
    checkTrace(incident!, sink);
  });

  it("calls a lone redundancy member sensor-drift with confidence 0.9", () => {
    const grid = makeGrid(4);
    const { ctx, sink } = scenario(grid, {
      graph: graphOf([relation("S01", "S04", 0, 0.98), relation("S01", "S02")], [{ sensors: ["S01", "S04"], evidenceId: "ev-00000000-00001" }]),
      drifts: () => [driftOf("S01", grid)],
    });
    const [incident] = separateFaults(ctx, sink);
    expect(incident!.value.faultClass).toBe("sensor-drift");
    expect(incident!.confidence).toBe(0.9);
    expect(incident!.value.trace[5]!.evidenceIds).toContain("ev-00000000-00001");
    expect(incident!.value.trace[2]!.stats.groupSize).toBe(2);
  });

  it("calls three related drivers with lagged onsets and a rising deviation process-slow-degradation", () => {
    const grid = makeGrid(5);
    const { ctx, sink } = scenario(grid, {
      graph: graphOf([relation("S01", "S02", 5), relation("S02", "S03", 5), relation("S01", "S03", 10), relation("S03", "S04")]),
      drifts: () => [
        driftOf("S01", grid, { onset: 1000, deviation: ramp(1000) }),
        driftOf("S02", grid, { onset: 1005, deviation: ramp(1005) }),
        driftOf("S03", grid, { onset: 1010, deviation: ramp(1010) }),
      ],
    });
    const incidents = separateFaults(ctx, sink);
    expect(incidents).toHaveLength(1);
    const [incident] = incidents;
    expect(incident!.value.faultClass).toBe("process-slow-degradation");
    expect(incident!.value.onset).toBe(1000);
    expect(incident!.value.ranked.map((r) => r.sensor).sort()).toEqual(["S01", "S02", "S03"]);
    expect(incident!.value.trace[3]!.stats.lagAgreement).toBe(1);
    expect(incident!.value.trace[3]!.stats.edges).toBe(3);
    expect(incident!.value.trace[3]!.stats.pValue).toBeLessThan(0.01);
    expect(contributionSum(incident!)).toBeCloseTo(1, 9);
    checkTrace(incident!, sink);
  });

  it("separates drivers whose onsets are far apart into two incidents", () => {
    const grid = makeGrid(4);
    const { ctx, sink } = scenario(grid, {
      graph: graphOf([relation("S01", "S02"), relation("S02", "S03")]),
      drifts: () => [driftOf("S01", grid, { onset: 1000 }), driftOf("S02", grid, { onset: 1600, deviation: ramp(1600) })],
    });
    const incidents = separateFaults(ctx, sink);
    expect(incidents.map((i) => i.value.onset)).toEqual([1000, 1600]);
  });

  it("calls a change point shared by 90% of sensors data-logging", () => {
    const grid = makeGrid(10);
    const { ctx, sink } = scenario(grid, {
      graph: graphOf([relation("S01", "S02")]),
      drifts: () => [driftOf("S01", grid)],
      changepoints: new Map(grid.aliases.slice(0, 9).map((a) => [a, [ONSET]])),
    });
    const [incident] = separateFaults(ctx, sink);
    expect(incident!.value.faultClass).toBe("data-logging");
    expect(incident!.value.trace[1]!.stats.share).toBeCloseTo(0.9, 9);
    expect(incident!.value.trace[1]!.stats.index).toBe(ONSET);
    expect(incident!.value.trace[5]!.result).toContain("Data fault: logging");
    checkTrace(incident!, sink);
  });

  it("excludes masked sensors from the ranked list and names them in the health step", () => {
    const grid = makeGrid(5);
    const { ctx, sink } = scenario(grid, {
      graph: graphOf([relation("S01", "S02"), relation("S01", "S03"), relation("S02", "S03")]),
      health: () => ({
        S03: { sensor: "S03", health: "stuck", masked: [window(900, N)], checks: [{ check: "stuck", pass: false, statistic: 0.001, threshold: 0.01 }] },
      }),
      drifts: () => [
        driftOf("S01", grid),
        driftOf("S02", grid, { victimOf: "S01" }),
        driftOf("S03", grid, { victimOf: "S01" }),
        driftOf("S05", grid, { victimOf: "S01" }),
      ],
    });
    const incidents = separateFaults(ctx, sink, { masked: ["S05"] });
    expect(incidents.map((i) => i.value.faultClass)).toEqual(["sensor-stuck", "sensor-drift-bias"]);
    const drift = incidents[1]!;
    expect(drift.value.excluded).toEqual(["S03", "S05"]);
    expect(drift.value.ranked.map((r) => r.sensor)).toEqual(["S01", "S02"]);
    expect(drift.value.trace[0]!.result).toContain("S03 (stuck)");
    expect(drift.value.trace[0]!.result).toContain("S05 (masked by the operator)");
    expect(drift.value.trace[0]!.stats.excluded).toBe(2);
    expect(drift.value.trace[0]!.evidenceIds).toContain(ctx.health[2]!.evidenceIds[0]);
    expect(contributionSum(drift)).toBeCloseTo(1, 9);
    checkTrace(drift, sink);
    checkTrace(incidents[0]!, sink);
  });

  it("reads the control loop rows from the roles", () => {
    const grid = makeGrid(4);
    const graph = graphOf([relation("S01", "S02", 3), relation("S02", "S03", 3), relation("S01", "S04")]);
    const roles = [roleOf("S01", "actuator"), roleOf("S02", "controlled"), roleOf("S03", "downstream"), roleOf("S04")];
    const holds = scenario(grid, { graph, roles, drifts: () => [driftOf("S01", grid)] });
    expect(separateFaults(holds.ctx, holds.sink)[0]!.value.faultClass).toBe("process-degradation");
    const shifts = scenario(grid, { graph, roles, drifts: () => [driftOf("S01", grid), driftOf("S03", grid, { victimOf: "S01" })] });
    const [incident] = separateFaults(shifts.ctx, shifts.sink);
    expect(incident!.value.faultClass).toBe("sensor-drift-hidden");
    expect(incident!.value.trace[4]!.stats.downstreamShifted).toBe(1);
    expect(incident!.value.trace[4]!.result).toContain("S02 (controlled) holds");
    checkTrace(incident!, shifts.sink);
  });

  it("applies a faultClass override keyed by the lead sensor and a responsible override", () => {
    const grid = makeGrid(4);
    const { ctx, sink } = scenario(grid, {
      graph: graphOf([relation("S01", "S02"), relation("S01", "S03")]),
      drifts: () => [driftOf("S01", grid), driftOf("S02", grid, { victimOf: "S01" })],
    });
    const [incident] = separateFaults(ctx, sink, { faultClass: { S01: "process-step" }, responsible: { S02: "S02" } });
    expect(incident!.value.faultClass).toBe("process-step");
    expect(incident!.value.trace[5]!.result).toContain("Process fault: step shift");
    expect(incident!.value.trace[5]!.result).toContain("operator");
    expect(incident!.value.ranked.map((r) => r.sensor).sort()).toEqual(["S01", "S02"]);
    expect(separateFaults(ctx, createMemorySink("0123abcd"), { faultClass: { S09: "process-step" } })[0]!.value.faultClass).toBe("sensor-drift-bias");
  });

  it("keeps the incident window at 100 samples or more", () => {
    const grid = makeGrid(4);
    const { ctx, sink } = scenario(grid, {
      graph: graphOf([relation("S01", "S02")]),
      drifts: () => [driftOf("S01", grid, { onset: 1980, deviation: ramp(1980) })],
    });
    const [incident] = separateFaults(ctx, sink);
    expect(incident!.value.window).toEqual(window(1900, N));
    expect(incident!.value.onset).toBe(1980);
  });
});

describe("pca", () => {
  it("fits the baseline, sets limits at 1.5 times the p99, and blames the sensor that leaves", () => {
    const grid = makeGrid(6);
    const model = fitPca(grid, BASELINE, grid.aliases)!;
    expect(model.sensors).toEqual(grid.aliases);
    expect(model.components).toBeGreaterThanOrEqual(1);
    expect(model.components).toBeLessThan(6);
    const clean = pcaStatistics(model, grid, BASELINE);
    expect(clean.n).toBe(1000);
    expect(clean.spe).toBeLessThan(model.speLimit);
    expect(clean.t2).toBeLessThan(model.t2Limit);
    const total = [...clean.contributions.values()].reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(1, 9);
    grid.values[2]!.set(ramp(ONSET, 5).map((v, t) => v + grid.values[2]![t]!));
    const broken = pcaStatistics(model, grid, window(ONSET, N));
    expect(broken.spe).toBeGreaterThan(model.speLimit);
    const top = [...broken.contributions.entries()].sort((a, b) => b[1] - a[1])[0]!;
    expect(top[0]).toBe("S03");
    expect(top[1]).toBeGreaterThan(0.5);
  });

  it("returns null with fewer than two varying sensors", () => {
    const grid = makeGrid(3);
    grid.values[1]!.fill(4);
    grid.values[2]!.fill(9);
    expect(fitPca(grid, BASELINE, grid.aliases)).toBeNull();
    expect(fitPca(grid, BASELINE, [])).toBeNull();
  });
});

describe("buildTrace", () => {
  it("copies only stats that exist in the cited evidence, in the six-step order", () => {
    const cited = { id: "ev-0123abcd-00001", stats: { a: 1.5, b: 2 } };
    const other = { id: "ev-0123abcd-00002", stats: { c: 3 } };
    const step: StepSpec = { name: "Test", n: 100, cited: [cited, other], keys: ["a", "c", "missing"], result: "x".repeat(400) };
    const steps = Object.fromEntries(TRACE_TESTS.map((t) => [t, step])) as Record<TraceTest, StepSpec>;
    const trace = buildTrace(steps);
    expect(trace.map((s) => s.test)).toEqual(TRACE_TESTS);
    expect(trace[0]!.stats).toEqual({ a: 1.5, c: 3 });
    expect(trace[0]!.evidenceIds).toEqual([cited.id, other.id]);
    expect(trace[0]!.result.length).toBeLessThanOrEqual(300);
    expect(() => buildTrace({ ...steps, verdict: { ...step, cited: [] } })).toThrow();
  });
});
