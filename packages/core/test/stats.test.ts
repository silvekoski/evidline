import { describe, expect, it } from "vitest";
import { injectFault } from "../src/inject";
import { gaussian, mulberry32 } from "../src/random";
import {
  acfTime,
  binarySegmentation,
  blockMedians,
  compressHold,
  crossCorrelation,
  cusum,
  diff,
  dominantPeriod,
  downsample,
  finiteSorted,
  hampel,
  histogram,
  holdOf,
  mad,
  mannKendall,
  median,
  pearson,
  quantile,
  quantileSorted,
  quantiles,
  ranks,
  robustRegression,
  roundSig,
  runLengths,
  spearman,
  theilSen,
  wasserstein1,
} from "../src/stats";
import { window } from "../src/types";

function noise(n: number, seed: number, sigma = 1): Float64Array {
  const rng = mulberry32(seed);
  return Float64Array.from({ length: n }, () => sigma * gaussian(rng));
}

function sampleAndHold(n: number, hold: number, seed: number): Float64Array {
  const rng = mulberry32(seed);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i += hold) out.fill(gaussian(rng), i, Math.min(n, i + hold));
  return out;
}

describe("quantile family", () => {
  it("skips NaN and interpolates", () => {
    const x = Float64Array.from([5, NaN, 1, 3, 2, 4]);
    expect(quantile(x, 0.5)).toBe(3);
    expect(median(x)).toBe(3);
    expect(quantile(x, 0.25)).toBe(2);
    expect(quantiles(x).p99).toBeCloseTo(4.96, 6);
    expect(mad(x)).toBeCloseTo(1.4826, 6);
    expect(quantile(new Float64Array(0), 0.5)).toBe(0);
  });

  it("matches the sorted quantile on random data with NaN and ties", () => {
    const rng = mulberry32(2);
    for (let trial = 0; trial < 100; trial++) {
      const n = 1 + Math.floor(rng() * 400);
      const x = Float64Array.from({ length: n }, () => (rng() < 0.1 ? NaN : Math.round(gaussian(rng) * 4) / 4));
      const sorted = finiteSorted(x);
      for (const p of [0, 0.01, 0.5, 0.99, 1, rng()]) expect(quantile(x, p)).toBe(quantileSorted(sorted, p));
    }
    const ramp = Float64Array.from({ length: 10000 }, (_, i) => i);
    expect(quantile(ramp, 0.5)).toBe(4999.5);
    expect(quantile(ramp.slice().reverse(), 0.5)).toBe(4999.5);
  });
});

describe("theilSen", () => {
  it("recovers a line", () => {
    const y = Float64Array.from({ length: 100 }, (_, i) => 2 + 0.5 * i);
    y[10] = NaN;
    const fit = theilSen(y);
    expect(fit.slope).toBeCloseTo(0.5, 9);
    expect(fit.intercept).toBeCloseTo(2, 9);
  });

  it("samples pairs above 1500 points", () => {
    const e = noise(3000, 3);
    const y = Float64Array.from(e, (v, i) => 1 + 0.01 * i + v);
    const fit = theilSen(y);
    expect(Math.abs(fit.slope - 0.01)).toBeLessThan(0.0005);
  });
});

describe("mannKendall", () => {
  it("separates a trend from white noise", () => {
    const e = noise(200, 4);
    const trend = mannKendall(Float64Array.from(e, (v, i) => 0.02 * i + v));
    expect(trend.z).toBeGreaterThan(3);
    expect(trend.p).toBeLessThan(0.01);
    const flat = mannKendall(e);
    expect(flat.p).toBeGreaterThan(0.05);
    expect(Number.isFinite(flat.z)).toBe(true);
  });
});

describe("cusum", () => {
  const episodes = [window(0, 2000)];

  it("locates the onset of a mean shift", () => {
    const x = noise(2000, 5);
    for (let t = 1200; t < 2000; t++) x[t] = x[t]! + 2;
    x[1300] = NaN;
    const r = cusum(x, 0.5, 20, { start: 0, episodes });
    expect(r.alarms.length).toBeGreaterThan(0);
    const first = r.alarms[0]!;
    expect(first.side).toBe(1);
    expect(Math.abs(first.onset - 1200)).toBeLessThanOrEqual(100);
    expect(first.index).toBeGreaterThan(first.onset);
    expect(r.pos[1300]).toBe(r.pos[1299]);
  });

  it("stays quiet on white noise and restarts at episode boundaries", () => {
    const x = noise(2000, 6);
    expect(cusum(x, 0.5, 20, { start: 0, episodes }).alarms).toEqual([]);
    for (let t = 0; t < 2000; t++) x[t] = x[t]! + 3;
    const split = cusum(x, 0.5, 20, { start: 500, episodes: [window(0, 1000), window(1000, 2000)] });
    expect(split.pos[499]).toBe(0);
    expect(split.pos[1000]).toBeLessThan(split.pos[999]!);
    expect(split.alarms.filter((a) => a.side === 1).map((a) => a.onset)).toEqual([500, 1000]);
  });
});

describe("crossCorrelation", () => {
  it("recovers a planted lag of 7 and skips pairs across a boundary", () => {
    const n = 3000;
    const a = noise(n, 7);
    const e = noise(n, 8, 0.2);
    const b = Float64Array.from({ length: n }, (_, t) => (t >= 7 ? a[t - 7]! : 0) + e[t]!);
    const r = crossCorrelation(a, b, 20);
    expect(r.bestLag).toBe(7);
    expect(r.bestRho).toBeGreaterThan(0.9);
    expect(r.lags.length).toBe(41);
    expect(r.rhos.length).toBe(41);
    expect(r.n).toBe(n - 7);
    const split = crossCorrelation(a, b, 20, [window(0, 1500), window(1500, n)]);
    expect(split.n).toBe(n - 14);
  });

  it("pearson and spearman use pairwise complete samples", () => {
    const a = Float64Array.from([1, 2, 3, 4, NaN, 6]);
    const b = Float64Array.from([2, 4, 6, 8, 10, NaN]);
    expect(pearson(a, b)).toEqual({ rho: 1, n: 4 });
    expect(spearman(a, b).rho).toBeCloseTo(1, 9);
    expect(pearson(new Float64Array(5), new Float64Array(5)).rho).toBe(0);
  });
});

describe("ranks", () => {
  it("averages ties and keeps NaN", () => {
    expect(Array.from(ranks(Float64Array.from([3, 1, NaN, 3, 2])))).toEqual([3.5, 1, NaN, 3.5, 2]);
  });
});

describe("binarySegmentation", () => {
  it("recovers a step at 60% within 1%", () => {
    const n = 10000;
    const x = noise(n, 9);
    for (let t = 6000; t < n; t++) x[t] = x[t]! + 3;
    const cps = binarySegmentation(x);
    expect(cps.length).toBe(1);
    expect(Math.abs(cps[0]! - 6000)).toBeLessThanOrEqual(100);
  });

  it("finds nothing in white noise and drops boundary points", () => {
    expect(binarySegmentation(noise(5000, 10))).toEqual([]);
    const x = noise(4000, 11);
    for (let t = 2000; t < 4000; t++) x[t] = x[t]! + 3;
    expect(binarySegmentation(x, { episodes: [window(0, 2000), window(2000, 4000)] })).toEqual([]);
  });
});

describe("robustRegression", () => {
  it("recovers coefficients with 5% outliers within 5%", () => {
    const n = 2000;
    const a = noise(n, 12);
    const b = noise(n, 13);
    const e = noise(n, 14, 0.1);
    const rng = mulberry32(15);
    const y = Float64Array.from({ length: n }, (_, t) => 1 + 2 * a[t]! - 3 * b[t]! + e[t]! + (rng() < 0.05 ? 50 : 0));
    y[5] = NaN;
    const fit = robustRegression([a, b], y);
    expect(Math.abs(fit.coef[0]! - 2)).toBeLessThan(0.1);
    expect(Math.abs(fit.coef[1]! + 3)).toBeLessThan(0.15);
    expect(Math.abs(fit.intercept - 1)).toBeLessThan(0.05);
    expect(fit.n).toBe(n - 1);
    expect(fit.residuals.length).toBe(n);
    expect(Number.isNaN(fit.residuals[5]!)).toBe(true);
    expect(fit.sigma).toBeGreaterThan(0.05);
    expect(fit.sigma).toBeLessThan(0.3);
  });

  it("fits an intercept only model without predictors", () => {
    const fit = robustRegression([], Float64Array.from([1, 2, 3, 4, 5]));
    expect(fit.coef).toEqual([]);
    expect(fit.intercept).toBeCloseTo(3, 6);
  });
});

describe("hampel", () => {
  it("flags planted spikes only", () => {
    const x = noise(1000, 16);
    const planted = [100, 300, 500];
    for (const t of planted) x[t] = x[t]! + 12;
    const flags = hampel(x, 7, 5);
    const flagged = Array.from(flags).flatMap((f, i) => (f ? [i] : []));
    expect(planted.every((t) => flagged.includes(t))).toBe(true);
    expect(flagged.length - planted.length).toBeLessThan(20);
    x[101] = NaN;
    expect(hampel(x, 7, 5)[100]).toBe(1);
    expect(hampel(x, 7, 5)[101]).toBe(0);
  });
});

describe("histogram", () => {
  it("has 21 edges and 20 shares that sum to 1", () => {
    const x = noise(5000, 17);
    const q = quantiles(x);
    const h = histogram(x, q.p1, q.p99);
    expect(h.edges.length).toBe(21);
    expect(h.shares.length).toBe(20);
    expect(h.shares.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 9);
    expect(h.shares[0]).toBeCloseTo(0.01, 2);
    expect(h.shares[19]).toBeCloseTo(0.01, 2);
    expect(h.edges[1]).toBeCloseTo(q.p1, 9);
    expect(h.edges[19]).toBeCloseTo(q.p99, 9);
  });

  it("puts a constant signal in one bin", () => {
    const h = histogram(new Float64Array(100).fill(7), 7, 7);
    expect(h.shares.filter((s) => s === 1).length).toBe(1);
    expect(h.shares.reduce((s, v) => s + v, 0)).toBe(1);
  });
});

describe("runs", () => {
  it("holdOf finds sample and hold of 2 and 5", () => {
    expect(holdOf(sampleAndHold(1000, 2, 18))).toBe(2);
    expect(holdOf(sampleAndHold(1000, 5, 19))).toBe(5);
    expect(holdOf(noise(1000, 20))).toBe(1);
  });

  it("runLengths breaks at NaN and episode boundaries", () => {
    const x = Float64Array.from([1, 1, NaN, 1, 1, 1, 2]);
    const r = runLengths(x);
    expect(Array.from(r.starts)).toEqual([0, 3, 6]);
    expect(Array.from(r.lengths)).toEqual([2, 3, 1]);
    expect(Array.from(r.values)).toEqual([1, 1, 2]);
    expect(Array.from(runLengths(x, [window(0, 4), window(4, 7)]).lengths)).toEqual([2, 1, 2, 1]);
  });

  it("compressHold keeps one value per hold", () => {
    const x = sampleAndHold(20, 5, 21);
    const c = compressHold(x, 5);
    expect(c.length).toBe(4);
    expect(c[1]).toBe(x[5]);
  });
});

describe("wasserstein1", () => {
  it("is close to the shift of two normals", () => {
    const a = noise(5000, 22);
    const b = Float64Array.from(noise(5000, 23), (v) => v + 3);
    expect(Math.abs(wasserstein1(a, b) - 3)).toBeLessThan(0.15);
    expect(wasserstein1(a, a)).toBe(0);
  });
});

describe("autocorrelation family", () => {
  it("finds the period of a sine and a short acfTime for noise", () => {
    const x = Float64Array.from({ length: 4000 }, (_, t) => Math.sin((2 * Math.PI * t) / 50));
    expect(dominantPeriod(x)).toBe(50);
    expect(acfTime(x)).toBeGreaterThan(5);
    expect(acfTime(noise(4000, 24))).toBe(1);
    expect(dominantPeriod(noise(4000, 25))).toBeNull();
  });
});

describe("series helpers", () => {
  it("downsample, blockMedians, diff and roundSig", () => {
    const x = Float64Array.from([1, 2, NaN, 4, 5, 6, 7]);
    expect(Array.from(downsample(x, 3))).toEqual([1.5, 5, 7]);
    const bm = blockMedians(Float64Array.from([1, 2, 3, 10, 11, 12, 100]), 3, 0, 7);
    expect(bm.medians).toEqual([2, 11.5]);
    expect(bm.centers).toEqual([1.5, 5]);
    const d = diff(Float64Array.from([1, 3, 6, 10]), [window(0, 2), window(2, 4)]);
    expect(Array.from(d)).toEqual([NaN, 2, NaN, 4]);
    expect(roundSig(1234.5678)).toBe(1230);
    expect(roundSig(0.00123456, 2)).toBe(0.0012);
    expect(roundSig(0)).toBe(0);
  });
});

describe("injectFault", () => {
  const x = noise(1000, 26);
  const rng = () => mulberry32(27);

  it("keeps the input and the length", () => {
    const before = x.slice();
    const y = injectFault(x, { kind: "bias", from: 100, magnitude: 5 }, rng());
    expect(y.length).toBe(1000);
    expect(Array.from(x)).toEqual(Array.from(before));
  });

  it("ramps bias and gain, holds dead, and steps", () => {
    const bias = injectFault(x, { kind: "bias", from: 200, to: 600, magnitude: 4 }, rng());
    expect(bias[199]).toBe(x[199]);
    expect(bias[200]).toBe(x[200]);
    expect(bias[599]! - x[599]!).toBeCloseTo(4, 9);
    expect(bias[400]! - x[400]!).toBeCloseTo((4 * 200) / 399, 9);
    expect(bias[600]).toBe(x[600]);
    const gain = injectFault(x, { kind: "gain", from: 0, magnitude: 1.1 }, rng());
    expect(gain[999]! / x[999]!).toBeCloseTo(1.1, 9);
    const dead = injectFault(x, { kind: "dead", from: 300, to: 400, magnitude: 0 }, rng());
    expect(new Set(dead.subarray(300, 400)).size).toBe(1);
    expect(dead[300]).toBe(x[300]);
    expect(dead[400]).toBe(x[400]);
    const step = injectFault(x, { kind: "step", from: 500, magnitude: 2 }, rng());
    expect(step[500]! - x[500]!).toBe(2);
    expect(step[499]).toBe(x[499]);
  });

  it("adds alternating spikes every 50 samples", () => {
    const y = injectFault(x, { kind: "spikes", from: 100, to: 300, magnitude: 6 }, rng());
    const changed = Array.from(y).flatMap((v, i) => (v !== x[i] ? [i] : []));
    expect(changed).toEqual([100, 150, 200, 250]);
    expect(y[100]! - x[100]!).toBeGreaterThan(0);
    expect(y[150]! - x[150]!).toBeLessThan(0);
    expect(Math.abs(y[100]! - x[100]!)).toBeCloseTo(6 * mad(x.subarray(100, 300)), 9);
  });

  it("scales noise, drops out a share, and rounds resolution", () => {
    const noisy = injectFault(x, { kind: "noise", from: 0, magnitude: 3 }, rng());
    const ratio = mad(diff(noisy)) / mad(diff(x));
    expect(ratio).toBeGreaterThan(2.5);
    expect(ratio).toBeLessThan(3.5);
    const dropped = injectFault(x, { kind: "dropout", from: 0, magnitude: 0.2 }, rng());
    const share = Array.from(dropped).filter((v) => Number.isNaN(v)).length / 1000;
    expect(Math.abs(share - 0.2)).toBeLessThan(0.05);
    const q = Float64Array.from(x, (v) => Math.round(v * 100) / 100);
    const coarse = injectFault(q, { kind: "resolution", from: 0, magnitude: 4 }, rng());
    for (const v of coarse) expect(Math.abs(v / 0.04 - Math.round(v / 0.04))).toBeLessThan(1e-9);
  });
});
