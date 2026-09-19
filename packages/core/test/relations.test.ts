import type { HealthValue } from "@tpm/schemas";
import { describe, expect, it } from "vitest";
import { fingerprint } from "../src/fingerprint";
import { gaussian, mulberry32 } from "../src/random";
import { relationGraph } from "../src/relations";
import { createMemorySink, window, type Grid } from "../src/types";

const thresholds = { relationRho: 0.3, redundancyRho: 0.95 };

function ar1(n: number, phi: number, seed: number): Float64Array {
  const rng = mulberry32(seed);
  const x = new Float64Array(n);
  for (let t = 1; t < n; t++) x[t] = phi * x[t - 1]! + gaussian(rng);
  return x;
}

function delayed(x: Float64Array, lag: number, sigma: number, seed: number): Float64Array {
  const rng = mulberry32(seed);
  return Float64Array.from(x, (_, t) => x[Math.max(0, t - lag)]! + sigma * gaussian(rng));
}

function makeGrid(columns: Float64Array[]): Grid {
  const n = columns[0]!.length;
  return {
    aliases: columns.map((_, i) => `S${String(i + 1).padStart(2, "0")}`),
    values: columns,
    n,
    dt: null,
    time: null,
    episodes: [window(0, n)],
  };
}

function analyze(grid: Grid, opts: { failed?: string[]; masks?: Uint8Array[]; baseline?: { from: number; to: number } } = {}) {
  const sink = createMemorySink("0123abcd");
  const fps = grid.values.map((x) => fingerprint(x, grid.episodes));
  const masks = opts.masks ?? grid.aliases.map(() => new Uint8Array(grid.n));
  const health: { value: HealthValue }[] = grid.aliases.map((sensor) => ({
    value: { sensor, health: opts.failed?.includes(sensor) ? "dead" : "healthy", masked: [], checks: [] },
  }));
  const baseline = window(opts.baseline?.from ?? 0, opts.baseline?.to ?? grid.n);
  return { sink, graph: relationGraph(grid, masks, health, baseline, fps, thresholds, sink) };
}

const pair = (graph: ReturnType<typeof analyze>["graph"], a: string, b: string) =>
  graph.relations.find((r) => r.a === a && r.b === b);

describe("relationGraph", () => {
  it("finds a chain with the right lags and the flow order", () => {
    const a = ar1(4000, 0.97, 1);
    const b = delayed(a, 5, 0.05, 2);
    const c = delayed(b, 3, 0.05, 3);
    const { graph, sink } = analyze(makeGrid([a, b, c]));

    expect(pair(graph, "S01", "S02")).toMatchObject({ lag: 5 });
    expect(pair(graph, "S02", "S03")).toMatchObject({ lag: 3 });
    expect(pair(graph, "S01", "S03")).toMatchObject({ lag: 8 });
    expect(graph.flowOrder).toEqual(["S01", "S02", "S03"]);
    for (const r of graph.relations) {
      expect(Math.abs(r.rhoAtLag)).toBeGreaterThan(Math.abs(r.rho) + 0.02);
      expect(r.rho).toBeGreaterThan(0.3);
    }

    const lagEvidence = sink.evidence.find((e) => e.id === pair(graph, "S01", "S02")!.evidenceId)!;
    expect(lagEvidence.kind).toBe("lag");
    expect(lagEvidence.sensors).toEqual(["S01", "S02"]);
    expect(lagEvidence.stats).toMatchObject({ lag: 5, n: 4000, bucket: 1 });
    expect(lagEvidence.chart.type).toBe("lag");
    expect(lagEvidence.chart.lags).toHaveLength(65);
    expect(lagEvidence.chart.marks).toEqual([{ at: 5, label: "best lag 5", kind: "best-lag" }]);
    const bestPoint = lagEvidence.chart.lags!.reduce((top, p) => (Math.abs(p.rho) > Math.abs(top.rho) ? p : top));
    expect(bestPoint.lag).toBe(5);

    const correlation = sink.evidence.filter((e) => e.kind === "correlation");
    expect(correlation).toHaveLength(3);
    expect(correlation[0]!.chart.type).toBe("scatter");
    expect(correlation[0]!.stats.n).toBe(4000);

    const flow = sink.evidence.find((e) => e.method === "topological-sort")!;
    expect(flow.sensors).toEqual(["S01", "S02", "S03"]);
    expect(flow.stats).toEqual({ nodes: 3, edges: 3, broken: 0 });
    expect(flow.chart.bars).toEqual([
      { label: "S01", value: 2 },
      { label: "S02", value: 0 },
      { label: "S03", value: -2 },
    ]);

    const peers = graph.peers.get("S02")!;
    expect(peers).toHaveLength(2);
    expect(peers.find((p) => p.alias === "S01")).toMatchObject({ lag: 5, n: 4000 });
    expect(peers.find((p) => p.alias === "S03")).toMatchObject({ lag: -3, n: 4000 });
    expect(Math.abs(peers[0]!.rho)).toBeGreaterThanOrEqual(Math.abs(peers[1]!.rho));
    expect(graph.peers.get("S01")!.map((p) => p.alias)).toEqual(["S02", "S03"]);
    expect(graph.groups).toEqual([]);
  });

  it("scales the lag back to grid samples when the baseline copy is bucketed", () => {
    const a = ar1(16000, 0.99, 4);
    const b = delayed(a, 10, 0.05, 5);
    const { graph, sink } = analyze(makeGrid([a, b]));
    const r = pair(graph, "S01", "S02")!;
    expect(r.lag).toBe(10);
    const evidence = sink.evidence.find((e) => e.id === r.evidenceId)!;
    expect(evidence.stats.bucket).toBe(2);
    expect(evidence.chart.lags!.map((p) => p.lag)).toEqual(Array.from({ length: 65 }, (_, k) => (k - 32) * 2));
  });

  it("puts a redundant pair in a group with structure evidence", () => {
    const a = ar1(3000, 0.9, 6);
    const twin = delayed(a, 0, 0.01, 7);
    const other = ar1(3000, 0.9, 8);
    const { graph, sink } = analyze(makeGrid([a, twin, other]));

    expect(graph.groups).toHaveLength(1);
    expect(graph.groups[0]!.sensors).toEqual(["S01", "S02"]);
    expect(pair(graph, "S01", "S02")).toMatchObject({ lag: 0 });
    const evidence = sink.evidence.find((e) => e.id === graph.groups[0]!.evidenceId)!;
    expect(evidence.kind).toBe("structure");
    expect(evidence.method).toBe("redundancy-group");
    expect(evidence.sensors).toEqual(["S01", "S02"]);
    expect(evidence.stats.minRho).toBeGreaterThan(0.95);
    expect(graph.flowOrder).toEqual([]);
    expect(sink.evidence.find((e) => e.method === "topological-sort")!.stats.edges).toBe(0);
  });

  it("never lists a sensor with a failed health check as a peer", () => {
    const a = ar1(4000, 0.97, 9);
    const b = delayed(a, 5, 0.05, 10);
    const d = delayed(a, 0, 0.05, 11);
    const { graph } = analyze(makeGrid([a, b, d]), { failed: ["S03"] });

    expect(pair(graph, "S01", "S03")).toBeDefined();
    expect(graph.peers.get("S01")!.map((p) => p.alias)).toEqual(["S02"]);
    expect(graph.peers.get("S02")!.map((p) => p.alias)).toEqual(["S01"]);
    expect(graph.peers.get("S03")!.map((p) => p.alias)).toEqual(["S01", "S02"]);
  });

  it("keeps at most 5 peers ordered by |rho| and skips masked and constant samples", () => {
    const a = ar1(4000, 0.95, 12);
    const copies = [0.4, 0.1, 0.6, 0.2, 0.5, 0.3, 0.7].map((sigma, k) => delayed(a, 0, sigma, 20 + k));
    const grid = makeGrid([a, ...copies, new Float64Array(4000).fill(7)]);
    const masks = grid.aliases.map(() => new Uint8Array(grid.n));
    masks[0]!.fill(1, 0, 500);
    const { graph } = analyze(grid, { masks, baseline: { from: 0, to: 3000 } });

    const peers = graph.peers.get("S01")!;
    expect(peers.map((p) => p.alias)).toEqual(["S03", "S05", "S07", "S02", "S06"]);
    expect(peers.every((p) => p.n === 2500)).toBe(true);
    expect(graph.relations.some((r) => r.a === "S09" || r.b === "S09")).toBe(false);
    expect(graph.peers.get("S09")).toEqual([]);
  });

  it("breaks a cycle at its weakest edge", () => {
    const n = 2500;
    const wave = (shift: number, sigma: number, seed: number) => {
      const rng = mulberry32(seed);
      return Float64Array.from({ length: n }, (_, t) => {
        const phase = (2 * Math.PI * (t - shift)) / 50;
        return Math.sin(phase) + 0.5 * Math.sin(2 * phase) + sigma * gaussian(rng);
      });
    };
    const { graph, sink } = analyze(makeGrid([wave(0, 0.05, 30), wave(17, 0.05, 31), wave(34, 0.3, 32)]));

    expect(pair(graph, "S01", "S02")!.lag).toBe(17);
    expect(pair(graph, "S02", "S03")!.lag).toBe(17);
    expect(pair(graph, "S01", "S03")!.lag).toBe(-16);
    expect(graph.flowOrder).toHaveLength(3);
    expect(new Set(graph.flowOrder)).toEqual(new Set(["S01", "S02", "S03"]));
    expect(sink.evidence.find((e) => e.method === "topological-sort")!.stats.broken).toBe(1);
  });
});
