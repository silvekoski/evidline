import { Role, type HealthValue } from "@tpm/schemas";
import { describe, expect, it } from "vitest";
import { fingerprint } from "../src/fingerprint";
import { gaussian, mulberry32 } from "../src/random";
import { relationGraph } from "../src/relations";
import { scoreRoles } from "../src/roles";
import { createMemorySink, window, type Grid } from "../src/types";

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

function steps(n: number, levels: number[], seed: number, minHold: number, maxHold: number): Float64Array {
  const rng = mulberry32(seed);
  const x = new Float64Array(n);
  let level = levels[0]!;
  for (let t = 0; t < n; ) {
    let next = level;
    while (next === level) next = levels[Math.floor(rng() * levels.length)]!;
    level = next;
    const hold = minHold + Math.floor(rng() * (maxHold - minHold + 1));
    x.fill(level, t, Math.min(n, t + hold));
    t += hold;
  }
  return x;
}

function response(x: Float64Array, delay: number, alpha: number, sigma: number, seed: number): Float64Array {
  const rng = mulberry32(seed);
  const y = new Float64Array(x.length);
  for (let t = 1; t < x.length; t++) y[t] = (1 - alpha) * y[t - 1]! + alpha * x[Math.max(0, t - delay)]! + sigma * gaussian(rng);
  return y;
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

function roles(columns: Float64Array[]) {
  const grid = makeGrid(columns);
  const sink = createMemorySink("0123abcd");
  const fps = grid.values.map((x) => fingerprint(x, grid.episodes));
  const masks = grid.aliases.map(() => new Uint8Array(grid.n));
  const health: { value: HealthValue }[] = grid.aliases.map((sensor) => ({ value: { sensor, health: "healthy", masked: [], checks: [] } }));
  const baseline = window(0, grid.n);
  const graph = relationGraph(grid, masks, health, baseline, fps, { relationRho: 0.3, redundancyRho: 0.95 }, sink);
  const results = scoreRoles(grid, fps, graph, baseline, sink);
  return { grid, sink, graph, results, byAlias: new Map(results.map((r) => [r.value.sensor, r])) };
}

describe("scoreRoles", () => {
  it("finds the setpoint, the actuator and the controlled variable of a loop", () => {
    const sp = steps(4000, [0, 1, 2, 3], 1, 25, 60);
    const act = response(sp, 2, 0.3, 0.02, 2);
    const cv = response(act, 3, 0.25, 0.02, 3);
    const { byAlias, sink } = roles([sp, act, cv]);

    const setpoint = byAlias.get("S01")!;
    const actuator = byAlias.get("S02")!;
    const controlled = byAlias.get("S03")!;
    expect(setpoint.value.role).toBe("setpoint");
    expect(actuator.value.role).toBe("actuator");
    expect(controlled.value.role).toBe("controlled");
    for (const r of [setpoint, actuator, controlled]) {
      expect(r.confidence).toBeGreaterThan(0.1);
      expect(r.confidence).toBeLessThanOrEqual(1);
      expect(r.claim).toContain(`${r.value.sensor} is`);
      const cited = r.evidenceIds.map((id) => sink.evidence.find((e) => e.id === id)!);
      expect(cited.every(Boolean)).toBe(true);
      expect(cited[0]!.kind).toBe("distribution");
      expect(cited.some((e) => e.kind === "lag")).toBe(true);
    }
    expect(setpoint.claim).toContain("4 levels");
    expect(actuator.claim).toContain("leads controlled variable S03");
    expect(controlled.claim).toContain("tracks setpoint S01");
  });

  it("finds a counter, a state flag, upstream drivers and a downstream indicator", () => {
    const n = 4000;
    const counter = Float64Array.from({ length: n }, (_, t) => t);
    const flag = steps(n, [0, 1], 4, 10, 80);
    const drivers = [ar1(n, 0.95, 5), ar1(n, 0.95, 6), ar1(n, 0.95, 7)];
    const rng = mulberry32(8);
    const indicator = Float64Array.from({ length: n }, (_, t) => {
      const lagged = [4, 6, 8].map((lag, k) => drivers[k]![Math.max(0, t - lag)]!);
      return lagged[0]! + lagged[1]! + lagged[2]! + 0.1 * gaussian(rng);
    });
    const { byAlias } = roles([counter, flag, ...drivers, indicator]);

    expect(byAlias.get("S01")!.value.role).toBe("counter");
    expect(byAlias.get("S01")!.confidence).toBeGreaterThan(0.9);
    expect(byAlias.get("S02")!.value.role).toBe("state");
    expect(byAlias.get("S02")!.claim).toContain("2 levels and no sensor tracks it");
    for (const alias of ["S03", "S04", "S05"]) expect(byAlias.get(alias)!.value.role).toBe("upstream");
    const indicatorRole = byAlias.get("S06")!;
    expect(indicatorRole.value.role).toBe("downstream");
    expect(indicatorRole.claim).toContain("3 sensors lead it and it leads none");
    expect(indicatorRole.evidenceIds).toHaveLength(4);
  });

  it("marks a redundant pair and applies the actuator rule without a setpoint", () => {
    const a = ar1(4000, 0.9, 9);
    const twin = delayed(a, 0, 0.02, 10);
    const wide = ar1(4000, 0.97, 11);
    const narrow = Float64Array.from(wide, (v) => Math.sign(v) * Math.sqrt(Math.abs(v)));
    const led = delayed(wide, 5, 0.1, 12);
    const { byAlias, graph } = roles([a, twin, wide, narrow, led]);

    expect(graph.groups.map((g) => g.sensors)).toEqual([
      ["S01", "S02"],
      ["S03", "S04"],
    ]);
    expect(byAlias.get("S01")!.value.role).toBe("redundant");
    expect(byAlias.get("S02")!.value.role).toBe("redundant");
    expect(byAlias.get("S01")!.claim).toContain("agrees with S02");
    expect(byAlias.get("S03")!.value.role).toBe("actuator");
    expect(byAlias.get("S03")!.claim).toContain("lag-0 partner S04 holds a narrower range");
    expect(byAlias.get("S04")!.value.role).toBe("controlled");
    expect(byAlias.get("S04")!.claim).toContain("moves with actuator S03");
  });

  it("scores a constant sensor and an unrelated sensor as unknown with all nine keys", () => {
    const { results, byAlias, sink } = roles([new Float64Array(2000).fill(3), ar1(2000, 0.5, 13), ar1(2000, 0.5, 14)]);

    for (const r of results) {
      expect(Object.keys(r.value.scores).sort()).toEqual([...Role.options].sort());
      expect(Object.values(r.value.scores).every((s) => s >= 0 && s <= 1)).toBe(true);
      expect(r.value.hypothesisName).toBeNull();
      expect(r.evidenceIds.length).toBeGreaterThan(0);
    }
    const constant = byAlias.get("S01")!;
    expect(constant.value.role).toBe("unknown");
    expect(constant.claim).toBe("S01 is constant, so it has no role.");
    expect(Object.values(constant.value.scores).every((s) => s === 0)).toBe(true);
    expect(byAlias.get("S02")!.value.role).toBe("unknown");
    expect(byAlias.get("S02")!.claim).toBe("S02 has no role above the floor.");

    const distributions = sink.evidence.filter((e) => e.kind === "distribution");
    expect(distributions.map((e) => e.sensors[0])).toEqual(["S01", "S02", "S03"]);
    expect(distributions[0]!.chart.type).toBe("histogram");
    expect(distributions[0]!.chart.histograms![0]!.shares).toHaveLength(20);
    expect(Object.values(distributions[0]!.stats).every(Number.isFinite)).toBe(true);
  });

  it("reduces the confidence by the missing rate", () => {
    const counter = Float64Array.from({ length: 2000 }, (_, t) => (t % 4 === 0 ? NaN : t));
    const { byAlias } = roles([counter, ar1(2000, 0.5, 15)]);
    const r = byAlias.get("S01")!;
    expect(r.value.role).toBe("counter");
    expect(r.confidence).toBeCloseTo(0.75 * (r.value.scores.counter - r.value.scores.unknown), 6);
  });
});
