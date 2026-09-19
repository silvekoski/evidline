import { Evidence as EvidenceSchema } from "@tpm/schemas";
import { describe, expect, it } from "vitest";
import { selectBaseline } from "../src/baseline";
import { fingerprint } from "../src/fingerprint";
import { gaussian, mulberry32 } from "../src/random";
import { createMemorySink, window, type Grid } from "../src/types";

function makeGrid(n: number, sensors: number, seed: number, episodes = [window(0, n)]): Grid {
  const rng = mulberry32(seed);
  const values = Array.from({ length: sensors }, () => Float64Array.from({ length: n }, () => gaussian(rng)));
  return {
    aliases: values.map((_, i) => `S${String(i + 1).padStart(2, "0")}`),
    values,
    n,
    dt: null,
    time: null,
    episodes,
  };
}

function shift(x: Float64Array, from: number, to: number, by: number): void {
  for (let t = from; t < to; t++) x[t] = x[t]! + by;
}

function run(grid: Grid) {
  const sink = createMemorySink("0123abcd");
  const fps = grid.values.map((x) => fingerprint(x, grid.episodes));
  return { result: selectBaseline(grid, fps, sink), sink };
}

describe("selectBaseline", () => {
  it("ends within 1% of a step shared by 8 sensors at 70%", () => {
    const grid = makeGrid(10000, 8, 1);
    for (const x of grid.values) shift(x, 7000, 10000, 3);
    const { result, sink } = run(grid);
    expect(Math.abs(result.value.window.to - 7000)).toBeLessThanOrEqual(100);
    expect(result.value.window.from).toBe(0);
    expect(result.value.window.n).toBe(result.value.window.to);
    expect(result.value.changepoints.length).toBe(1);
    expect(result.confidence).toBe(1);
    expect(result.claim).toContain("shared by 8 sensors");
    expect(result.evidenceIds.length).toBe(9);
    expect(sink.evidence.map((e) => e.kind)).toEqual([...Array(8).fill("changepoint"), "structure"]);
    const structure = sink.evidence.at(-1)!;
    expect(structure.window).toEqual(result.value.window);
    expect(structure.chart.marks).toEqual([{ at: result.value.window.to, label: `baseline end ${result.value.window.to}`, kind: "boundary" }]);
    expect(structure.chart.series.length).toBe(5);
    for (const e of sink.evidence) {
      expect(EvidenceSchema.safeParse(e).success).toBe(true);
      expect(Object.values(e.stats).every(Number.isFinite)).toBe(true);
    }
    const first = sink.evidence[0]!;
    expect(first.sensors).toEqual(["S01"]);
    expect(first.chart.marks?.[0]?.kind).toBe("changepoint");
    expect(first.stats.maxMove).toBeGreaterThan(2.5);
  });

  it("counts a change point of one sensor that moves more than 3 scales", () => {
    const grid = makeGrid(10000, 8, 2);
    shift(grid.values[3]!, 4000, 10000, 12);
    const { result } = run(grid);
    expect(Math.abs(result.value.window.to - 4000)).toBeLessThanOrEqual(100);
    expect(result.confidence).toBe(1);
    expect(result.claim).toContain("moves S04 by");
  });

  it("ignores a small change of one sensor", () => {
    const grid = makeGrid(10000, 8, 3);
    shift(grid.values[5]!, 3000, 10000, 1);
    const { result, sink } = run(grid);
    expect(result.value.window).toEqual(window(0, 6000));
    expect(result.value.changepoints).toEqual([]);
    expect(sink.evidence.filter((e) => e.kind === "changepoint").map((e) => e.sensors[0])).toEqual(["S06"]);
    expect(result.confidence).toBe(7 / 8);
  });

  it("finds no change point at an episode boundary with level jumps", () => {
    const n = 10000;
    const episodes = Array.from({ length: 10 }, (_, k) => window(k * 1000, (k + 1) * 1000));
    const grid = makeGrid(n, 8, 4, episodes);
    for (const x of grid.values) episodes.forEach((e, k) => shift(x, e.from, e.to, 5 * k));
    const { result, sink } = run(grid);
    const tolerance = Math.max(2, Math.floor(0.001 * n));
    for (const e of sink.evidence) {
      for (const mark of e.chart.marks ?? []) {
        if (mark.kind !== "changepoint") continue;
        expect(episodes.every((ep) => Math.abs(mark.at - ep.from) > tolerance)).toBe(true);
      }
    }
    expect(result.value.changepoints).toEqual([]);
    expect(result.value.window).toEqual(window(0, 6000));
    expect(result.confidence).toBe(1);
  });

  it("snaps the end to an earlier episode boundary within 5% of n", () => {
    const n = 10000;
    const episodes = Array.from({ length: 10 }, (_, k) => window(k * 1000, (k + 1) * 1000));
    const grid = makeGrid(n, 8, 5, episodes);
    for (const x of grid.values) shift(x, 7300, n, 3);
    const { result } = run(grid);
    expect(result.value.window.to).toBe(7000);
    expect(Math.abs(result.value.changepoints[0]! - 7300)).toBeLessThanOrEqual(100);
    expect(result.claim).toContain("snaps to the episode boundary at sample 7000");
  });

  it("skips a change point before the minimum length", () => {
    const grid = makeGrid(10000, 8, 6);
    for (const x of grid.values) shift(x, 500, 10000, 3);
    const { result } = run(grid);
    expect(result.value.window).toEqual(window(0, 6000));
    expect(result.value.changepoints.length).toBe(1);
    expect(result.confidence).toBe(0);
    expect(result.claim).toContain("minimum length of 1000 samples");
  });

  it("gives the first 60% of a clean grid", () => {
    const grid = makeGrid(5000, 8, 7);
    const { result, sink } = run(grid);
    expect(result.value.window).toEqual(window(0, 3000));
    expect(result.value.changepoints).toEqual([]);
    expect(result.confidence).toBe(1);
    expect(result.evidenceIds).toEqual([sink.evidence[0]!.id]);
    expect(sink.evidence[0]!.kind).toBe("structure");
    expect(sink.evidence[0]!.sensors).toEqual(grid.aliases);
    expect(result.claim).toBe("Baseline is the first 3000 samples. No change point counts, so the baseline is the first 60% of the grid.");
  });
});
