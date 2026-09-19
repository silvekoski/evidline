import type { Fingerprint } from "@tpm/schemas";
import { describe, expect, it } from "vitest";
import { calibrateDrift } from "../src/calibrate-drift";
import { detectDrift, driftBlock, type DriftThresholds } from "../src/drift";
import { injectFault } from "../src/inject";
import { fitPeerModel } from "../src/peer-model";
import { gaussian, mulberry32 } from "../src/random";
import type { Peer, RelationGraph } from "../src/relations";
import { createMemorySink, window, type Grid, type Masks } from "../src/types";

const N = 12_000;
const BASELINE = window(0, 6000);
const FAULT_AT = 8000;
const LAGS = [0, 2, 5, 8, 12, 15];
const GAINS = [1, -0.8, 1.2, 0.6, -1, 0.9];
const OFFSETS = [10, 20, 50, 5, 0, 30];
const thresholds: DriftThresholds = { cusumH: 10, cusumK: 0.5, deviationLimit: 3, distributionLimit: 20 };

function ar1(n: number, phi: number, rng: () => number): Float64Array {
  const out = new Float64Array(n);
  for (let t = 1; t < n; t++) out[t] = phi * out[t - 1]! + gaussian(rng);
  return out;
}

function fp(signalType: Fingerprint["signalType"]): Fingerprint {
  const quantiles = { p1: 0, p5: 0, p25: 0, p50: 0, p75: 0, p95: 0, p99: 0 };
  return {
    n: N,
    missingRate: 0,
    quantiles,
    mad: 1,
    histogram: { edges: [], shares: [] },
    step: 0,
    hold: 1,
    noise: 1,
    acfTime: 1,
    period: null,
    flatShare: 0,
    monotonicShare: 0,
    distinct: N,
    signalType,
  };
}

function emptyGraph(peers: Map<string, Peer[]>): RelationGraph {
  return { relations: [], groups: [], flowOrder: [], peers };
}

function system(seed: number, episodes = [window(0, N)]): { grid: Grid; masks: Masks; graph: RelationGraph; fps: Fingerprint[] } {
  const rng = mulberry32(seed);
  const driver = ar1(N + 20, 0.98, rng);
  const aliases = LAGS.map((_, i) => `S0${i + 1}`);
  const values = LAGS.map((lag, i) =>
    Float64Array.from({ length: N }, (_, t) => OFFSETS[i]! + GAINS[i]! * driver[t + 20 - lag]! + gaussian(rng)),
  );
  const peers = new Map<string, Peer[]>();
  aliases.forEach((alias, i) => {
    peers.set(
      alias,
      aliases.filter((_, j) => j !== i).map((other, k) => ({ alias: other, lag: LAGS[i]! - LAGS[k < i ? k : k + 1]!, rho: 0.9, n: 6000 })),
    );
  });
  return {
    grid: { aliases, values, n: N, dt: null, time: null, episodes },
    masks: aliases.map(() => new Uint8Array(N)),
    graph: emptyGraph(peers),
    fps: aliases.map(() => fp("fast")),
  };
}

const roles = LAGS.map((_, i) => ({ value: { sensor: `S0${i + 1}`, role: "unknown" as const } }));

describe("detectDrift on the peer path", () => {
  it("finds a 6 sigma bias ramp on a follower, locates its onset and names it responsible", () => {
    const { grid, masks, graph, fps } = system(1);
    const sigma = fitPeerModel(grid, 2, graph.peers.get("S03")!, BASELINE, masks).sigma;
    expect(sigma).toBeGreaterThan(0.8);
    expect(sigma).toBeLessThan(1.6);
    grid.values[2] = injectFault(grid.values[2]!, { kind: "bias", from: FAULT_AT, magnitude: 6 * sigma }, mulberry32(9));
    const sink = createMemorySink("0123abcd");
    const results = detectDrift(grid, masks, graph, roles, BASELINE, fps, thresholds, sink);
    expect(results).toHaveLength(6);
    const s03 = results.find((r) => r.value.sensor === "S03")!;
    expect(s03.value.drifting).toBe(true);
    expect(s03.value.method).toBe("peer-residual");
    expect(s03.value.peers).toHaveLength(5);
    expect(s03.value.maxDeviation).toBeGreaterThan(4);
    expect(s03.value.severity).toBeGreaterThanOrEqual(1);
    expect(s03.value.onset).not.toBeNull();
    expect(Math.abs(s03.value.onset! - FAULT_AT)).toBeLessThanOrEqual(500);
    expect(s03.value.detectionDelay).toBeGreaterThanOrEqual(0);
    expect(s03.value.responsible).toBe("S03");
    expect(s03.victimOf).toBeNull();
    expect(s03.value.pValue).toBeLessThan(0.01);
    expect(s03.value.ratePer1000).toBeGreaterThan(0.5);
    expect(s03.confidence).toBeGreaterThan(0);
    expect(s03.claim).toContain("drifts from its 5 peers");
    expect(s03.claim).toContain("responsible");
    for (const r of results) {
      if (r.value.sensor === "S03") continue;
      expect(!r.value.drifting || r.victimOf === "S03").toBe(true);
    }
    const kinds = s03.evidenceIds.map((id) => sink.evidence.find((e) => e.id === id)!.kind);
    expect(kinds).toEqual(["residual", "trend", "changepoint"]);
    const residual = sink.evidence.find((e) => e.id === s03.evidenceIds[0])!;
    expect(residual.chart.series.map((s) => s.key)).toEqual(["value", "expected", "S01", "S02", "S04", "S05", "S06"]);
    expect(residual.chart.band).toBeDefined();
    expect(residual.chart.secondary?.[0]?.source).toEqual({ derived: "deviation" });
    expect(residual.chart.threshold).toBe(3);
    const derived = sink.derived.get(residual.id)!;
    expect(derived.expected).toHaveLength(N);
    expect(derived.deviation).toHaveLength(N);
    expect(s03.model?.deviation).toBe(derived.deviation);
    for (const e of sink.evidence) for (const v of Object.values(e.stats)) expect(Number.isFinite(v)).toBe(true);
  });

  it("reports zero drifting sensors on a clean system", () => {
    const { grid, masks, graph, fps } = system(2);
    const results = detectDrift(grid, masks, graph, roles, BASELINE, fps, thresholds, createMemorySink("0123abcd"));
    expect(results.filter((r) => r.value.drifting)).toHaveLength(0);
    for (const r of results) {
      expect(r.value.onset).toBeNull();
      expect(r.value.responsible).toBeNull();
      expect(r.value.severity).toBeLessThan(1);
      expect(r.confidence).toBe(0);
      expect(r.claim).toContain("tracks its 5 peers");
    }
  });

  it("detects a gain ramp", () => {
    const { grid, masks, graph, fps } = system(3);
    grid.values[2] = injectFault(grid.values[2]!, { kind: "gain", from: FAULT_AT, magnitude: 1.1 }, mulberry32(9));
    const results = detectDrift(grid, masks, graph, roles, BASELINE, fps, thresholds, createMemorySink("0123abcd"));
    const s03 = results.find((r) => r.value.sensor === "S03")!;
    expect(s03.value.drifting).toBe(true);
    expect(s03.value.responsible).toBe("S03");
    expect(Math.abs(s03.value.onset! - FAULT_AT)).toBeLessThanOrEqual(600);
  });

  it("keeps the deviation of the grid when one peer has NaN", () => {
    const { grid, masks, graph, fps } = system(4);
    grid.values[1]!.fill(NaN, 9000, 9200);
    const results = detectDrift(grid, masks, graph, roles, BASELINE, fps, thresholds, createMemorySink("0123abcd"));
    const s01 = results.find((r) => r.value.sensor === "S01")!;
    const finite = s01.model!.deviation.filter(Number.isFinite).length;
    expect(finite).toBeGreaterThanOrEqual(N - 220);
    expect(results.filter((r) => r.value.drifting)).toHaveLength(0);
  });

  it("never aligns a peer across an episode boundary and restarts CUSUM there", () => {
    const { grid, masks, graph, fps } = system(9, [window(0, 4000), window(4000, 8000), window(8000, N)]);
    const sigma = fitPeerModel(grid, 2, graph.peers.get("S03")!, BASELINE, masks).sigma;
    grid.values[2] = injectFault(grid.values[2]!, { kind: "bias", from: FAULT_AT, magnitude: 6 * sigma }, mulberry32(9));
    const results = detectDrift(grid, masks, graph, roles, BASELINE, fps, thresholds, createMemorySink("0123abcd"));
    const s03 = results.find((r) => r.value.sensor === "S03")!;
    const deviation = s03.model!.deviation;
    for (const start of [0, 4000, 8000]) {
      for (let t = start; t < start + 5; t++) expect(Number.isNaN(deviation[t])).toBe(true);
      expect(Number.isFinite(deviation[start + 5])).toBe(true);
    }
    for (const end of [4000, 8000, N]) {
      for (let t = end - 10; t < end; t++) expect(Number.isNaN(deviation[t])).toBe(true);
      expect(Number.isFinite(deviation[end - 11])).toBe(true);
    }
    expect(s03.value.drifting).toBe(true);
    expect(s03.value.onset).toBeGreaterThanOrEqual(FAULT_AT);
    expect(s03.value.onset).toBeLessThanOrEqual(FAULT_AT + 500);
  });

  it("applies the responsible override", () => {
    const { grid, masks, graph, fps } = system(5);
    grid.values[2] = injectFault(grid.values[2]!, { kind: "bias", from: FAULT_AT, magnitude: 8 }, mulberry32(9));
    const results = detectDrift(grid, masks, graph, roles, BASELINE, fps, thresholds, createMemorySink("0123abcd"), {
      responsible: { S03: "S05" },
    });
    const s03 = results.find((r) => r.value.sensor === "S03")!;
    expect(s03.value.drifting).toBe(true);
    expect(s03.value.responsible).toBe("S05");
    expect(s03.victimOf).toBe("S05");
    expect(s03.claim).toContain("operator set the responsible sensor to S05");
  });
});

describe("driftBlock", () => {
  it("uses one day when a day holds at least 20 samples, else n / 200", () => {
    const base = { aliases: [], values: [], n: N, time: null, episodes: [window(0, N)] };
    expect(driftBlock({ ...base, dt: null })).toBe(60);
    expect(driftBlock({ ...base, dt: 180_000 })).toBe(480);
    expect(driftBlock({ ...base, dt: 86_400_000 })).toBe(60);
  });
});

describe("detectDrift on the distance path", () => {
  it("finds a mean shift on a sensor without peers", () => {
    const x = ar1(N, 0.5, mulberry32(6));
    for (let t = FAULT_AT; t < N; t++) x[t] = x[t]! + 4.6;
    const grid: Grid = { aliases: ["S01"], values: [x], n: N, dt: null, time: null, episodes: [window(0, N)] };
    const sink = createMemorySink("0123abcd");
    const results = detectDrift(grid, [new Uint8Array(N)], emptyGraph(new Map()), [], BASELINE, [fp("slow")], thresholds, sink);
    expect(results).toHaveLength(1);
    const s01 = results[0]!;
    expect(s01.value.method).toBe("distribution");
    expect(s01.model).toBeNull();
    expect(s01.value.drifting).toBe(true);
    expect(s01.value.peers).toEqual([]);
    expect(Math.abs(s01.value.onset! - FAULT_AT)).toBeLessThanOrEqual(500);
    expect(s01.value.inRange).toBe(false);
    const distribution = sink.evidence.find((e) => e.kind === "distribution")!;
    expect(distribution.chart.histograms).toHaveLength(2);
    expect(sink.derived.get(distribution.id)!.distance).toHaveLength(N);
    expect(s01.claim).toContain("has no peers");
  });

  it("stays quiet on a clean sensor without peers", () => {
    const grid: Grid = { aliases: ["S01"], values: [ar1(N, 0.5, mulberry32(7))], n: N, dt: null, time: null, episodes: [window(0, N)] };
    const results = detectDrift(grid, [new Uint8Array(N)], emptyGraph(new Map()), [], BASELINE, [fp("slow")], thresholds, createMemorySink("0123abcd"));
    expect(results[0]!.value.drifting).toBe(false);
  });
});

describe("calibrateDrift", () => {
  it("reports the achieved false alarm rate and detects the 4 sigma ramp", () => {
    const { grid, masks, graph, fps } = system(8);
    const sink = createMemorySink("0123abcd");
    const result = calibrateDrift(grid, masks, graph, BASELINE, fps, sink, 11);
    expect(result.confidence).toBe(1);
    expect(result.value.targetFalseAlarmRate).toBe(0.01);
    expect(Number.isFinite(result.value.falseAlarmRate)).toBe(true);
    expect(result.value.falseAlarmRate).toBeLessThanOrEqual(0.01);
    expect([5, 10, 20, 50, 100, 200]).toContain(result.thresholds.cusumH);
    expect([0.5, 1]).toContain(result.thresholds.cusumK);
    expect([5, 10, 20, 50, 100, 200]).toContain(result.thresholds.distributionLimit);
    expect(result.thresholds.deviationLimit).toBe(3);
    expect(result.value.thresholds.cusumH).toBe(result.thresholds.cusumH);
    const bias4 = result.value.detection.find((d) => d.fault === "peer bias" && d.magnitude === 4)!;
    expect(bias4.detected).toBe(true);
    expect(Number.isInteger(bias4.delay)).toBe(true);
    const bias05 = result.value.detection.find((d) => d.fault === "peer bias" && d.magnitude === 0.5)!;
    expect(bias05.detected).toBe(false);
    expect(result.value.detection.some((d) => d.fault === "distance bias" && d.magnitude === 8 && d.detected)).toBe(true);
    const evidence = sink.evidence.find((e) => e.id === result.evidenceIds[0])!;
    expect(evidence.kind).toBe("calibration");
    expect(evidence.chart.type).toBe("bar");
    expect(evidence.chart.bars).toHaveLength(12);
    expect(result.claim).toContain("cusumH");
  });
});
