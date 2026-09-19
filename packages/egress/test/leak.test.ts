import { describe, expect, it } from "vitest";
import { buildLeakIndex, roundSig, scanForLeaks } from "../src/index";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sensors = 52;
const n = 20000;
const rng = mulberry32(7);
const raw = Array.from({ length: sensors }, (_, s) => {
  const values = new Float64Array(n);
  for (let i = 0; i < n; i++) values[i] = (s + 1) * rng() * 1000;
  return { alias: `S${String(s + 1).padStart(2, "0")}`, values };
});
const index = buildLeakIndex(raw, ["xmeas_1", "xmv_11", "plant-b", "te", "Reactor Level"]);

describe("leak index", () => {
  it("indexes every triple of the 52 x 20000 grid and finds a planted triple", () => {
    expect(index.size).toBeGreaterThan(10000);
    expect(index.size).toBeLessThanOrEqual(sensors * (n - 2));
    const v = raw[17]?.values as Float64Array;
    const planted = [v[4000], v[4001], v[4002]].map((x) => roundSig(x as number));
    expect(new Set(planted).size).toBe(3);
    expect(index.has(planted as [number, number, number])).toBe(true);
    expect(index.has([v[4000] as number, v[4001] as number, v[4002] as number])).toBe(true);
    expect(index.has([v[4000] as number, v[4002] as number, v[4001] as number])).toBe(false);
  });

  it("finds a planted run in prose and in a JSON array and scans under 50 ms", () => {
    const v = raw[3]?.values as Float64Array;
    const triple = [v[100], v[101], v[102]].map((x) => roundSig(x as number));
    const prose = JSON.stringify({ purpose: "compile_rule", sentence: `the readings were ${triple.join(" ")} yesterday`, n: 500 });
    const array = JSON.stringify({ purpose: "name_role", sensor: { histogramShares: [0.1, ...triple, 0.2], n: 500 } });
    const clean = JSON.stringify({
      purpose: "name_role",
      dt: 180000,
      sensor: {
        alias: "S01",
        n: 500,
        quantiles: { p1: 0.5, p50: 1, p99: 1.5 },
        histogramShares: Array.from({ length: 20 }, (_, i) => i / 100),
      },
    });
    expect(scanForLeaks(prose, index).valueHits).toBe(1);
    expect(scanForLeaks(array, index).valueHits).toBe(1);
    expect(scanForLeaks(clean, index)).toMatchObject({ valueHits: 0, nameHits: 0 });
    for (const text of [prose, array, clean]) {
      const started = performance.now();
      scanForLeaks(text, index);
      expect(performance.now() - started).toBeLessThan(50);
    }
  });

  it("finds forbidden names case-insensitively at word boundaries and skips names under 3 characters", () => {
    expect(index.names).toEqual(["xmeas_1", "xmv_11", "plant-b", "Reactor Level"]);
    expect(scanForLeaks('{"question":"is XMEAS_1 broken?"}', index).nameHits).toBe(1);
    expect(scanForLeaks('{"question":"is xmeas_10 broken?"}', index).nameHits).toBe(0);
    expect(scanForLeaks('{"question":"reactor level and Plant-B"}', index).nameHits).toBe(2);
    expect(scanForLeaks('{"question":"the te process"}', index).nameHits).toBe(0);
  });

  it("ignores digits inside aliases and evidence ids", () => {
    const small = buildLeakIndex([{ alias: "S01", values: Float64Array.from([0, 1, 2, 3, 1, 1]) }], []);
    expect(scanForLeaks('{"ids":["ev-0a1b2c3d-00001","ev-0a1b2c3d-00002"],"sensor":"S01"}', small).valueHits).toBe(0);
    expect(scanForLeaks("values 0 1 2", small).valueHits).toBe(1);
  });

  it("counts a run only when the numbers are adjacent and not all equal", () => {
    const small = buildLeakIndex([{ alias: "S01", values: Float64Array.from([0, 1, 0, 0, 0, 5, 5, 5, 22.2, 22.2, 22.2]) }], []);
    expect(scanForLeaks('{"p95":0,"p99":1,"mad":0}', small).valueHits).toBe(0);
    expect(scanForLeaks('{"quantiles":{"p1":22.2,"p5":22.2,"p50":22.2},"shares":[0,0,0,1]}', small).valueHits).toBe(0);
    expect(scanForLeaks("[5,5,5]", small).valueHits).toBe(0);
    expect(scanForLeaks("0 then 1 then 0", small).valueHits).toBe(0);
    expect(scanForLeaks("[0,1,0]", small).valueHits).toBe(1);
    expect(scanForLeaks("0, 1, 0 and 0, 0, 5", small).valueHits).toBe(2);
  });
});
