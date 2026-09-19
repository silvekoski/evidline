import type { HealthClass, Window } from "@tpm/schemas";
import { describe, expect, it } from "vitest";
import { calibrateHealth } from "../src/calibrate-health";
import { fingerprint } from "../src/fingerprint";
import { defaultThresholds, healthBlockSize, healthGate, type HealthResult } from "../src/health";
import { injectFault } from "../src/inject";
import { gaussian, mulberry32 } from "../src/random";
import { proposeRules } from "../src/rules";
import { quantile } from "../src/stats";
import { createMemorySink, window, type Grid } from "../src/types";

const n = 12000;
const faultFrom = 7200;
const baseline = window(0, 6000);
const episodes = [window(0, 6000), window(6000, n)];
const w = healthBlockSize(n);
const rng = () => mulberry32(99);

function noise(seed: number): Float64Array {
  const r = mulberry32(seed);
  return Float64Array.from({ length: n }, () => gaussian(r));
}

function sampleAndHold(hold: number, seed: number): Float64Array {
  const r = mulberry32(seed);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i += hold) out.fill(gaussian(r), i, Math.min(n, i + hold));
  return out;
}

function quantize(x: Float64Array): Float64Array {
  return Float64Array.from(x, (v) => Math.round(v * 100) / 100);
}

function makeGrid(values: Float64Array[], time: Float64Array | null = null): Grid {
  return {
    aliases: values.map((_, i) => `S${String(i + 1).padStart(2, "0")}`),
    values: values.map(quantize),
    n,
    dt: time ? 180000 : null,
    time,
    episodes,
  };
}

const cleanValues = () => Array.from({ length: 8 }, (_, i) => noise(100 + i));

function gate(grid: Grid): { results: HealthResult[]; sink: ReturnType<typeof createMemorySink> } {
  const sink = createMemorySink("0123abcd");
  const fps = grid.values.map((x) => fingerprint(x, grid.episodes));
  return { results: healthGate(grid, baseline, fps, defaultThresholds, sink), sink };
}

function withFault(index: number, apply: (x: Float64Array) => Float64Array): Grid {
  const values = cleanValues();
  values[index] = apply(values[index]!);
  return makeGrid(values);
}

function coverage(masked: Window[], from: number, to: number): number {
  return masked.reduce((s, m) => s + Math.max(0, Math.min(m.to, to) - Math.max(m.from, from)), 0) / (to - from);
}

function expectFault(grid: Grid, index: number, cls: HealthClass): HealthResult {
  const { results, sink } = gate(grid);
  const r = results[index]!;
  expect(r.value.health).toBe(cls);
  expect(r.value.masked.length).toBeGreaterThan(0);
  expect(r.value.masked[0]!.from).toBeGreaterThanOrEqual(faultFrom - w);
  expect(r.value.masked[0]!.from).toBeLessThanOrEqual(faultFrom + w);
  expect(r.value.masked.at(-1)!.to).toBe(n);
  expect(coverage(r.value.masked, faultFrom, n)).toBeGreaterThanOrEqual(0.9);
  expect(coverage(r.value.masked, 0, baseline.to)).toBe(0);
  let maskedSamples = 0;
  for (const v of r.mask) maskedSamples += v;
  expect(maskedSamples).toBe(r.value.masked.reduce((s, m) => s + m.n, 0));
  const failed = r.value.checks.filter((c) => !c.pass);
  expect(failed[0]!.check).toBe(cls);
  expect(r.evidenceIds.length).toBe(failed.length);
  for (const id of r.evidenceIds) {
    const ev = sink.evidence.find((e) => e.id === id)!;
    expect(ev.kind).toBe("health");
    expect(ev.chart.masks!.length).toBeGreaterThan(0);
    expect(Number.isFinite(ev.stats.statistic)).toBe(true);
  }
  expect(r.confidence).toBeGreaterThan(0);
  expect(r.confidence).toBeLessThanOrEqual(1);
  expect(r.claim).toContain(cls);
  for (const other of results.filter((_, i) => i !== index)) expect(other.value.health).toBe("healthy");
  return r;
}

describe("healthGate", () => {
  it("passes every check on a clean grid", () => {
    const { results, sink } = gate(makeGrid(cleanValues()));
    expect(results.length).toBe(8);
    for (const r of results) {
      expect(r.value.health).toBe("healthy");
      expect(r.value.masked).toEqual([]);
      expect(r.value.checks.length).toBe(8);
      expect(r.value.checks.every((c) => c.pass)).toBe(true);
      expect(r.value.checks.every((c) => Number.isFinite(c.statistic) && Number.isFinite(c.threshold))).toBe(true);
      expect(r.mask.every((v) => v === 0)).toBe(true);
      expect(r.evidenceIds.length).toBe(1);
      const ev = sink.evidence.find((e) => e.id === r.evidenceIds[0])!;
      expect(ev.kind).toBe("health");
      expect(ev.stats.deadLimit).toBe(5);
      expect(ev.chart.band).toBeDefined();
      expect(r.confidence).toBeGreaterThan(0);
      expect(r.confidence).toBeLessThanOrEqual(1);
    }
  });

  it("finds a dead sensor and ranks dead over stuck on a flatline", () => {
    const r = expectFault(withFault(2, (x) => injectFault(x, { kind: "dead", from: faultFrom, magnitude: 0 }, rng())), 2, "dead");
    expect(r.value.checks.find((c) => c.check === "stuck")!.pass).toBe(false);
  });

  it("finds spikes", () => {
    expectFault(
      withFault(3, (x) => {
        const y = x.slice();
        const scale = 8 * 1.4826 * 0.6745;
        for (let t = faultFrom, sign = 1; t < n; t += 5, sign = -sign) y[t] = x[t]! + sign * scale;
        return y;
      }),
      3,
      "spikes",
    );
  });

  it("finds a noisy sensor", () => {
    expectFault(withFault(4, (x) => injectFault(x, { kind: "noise", from: faultFrom, magnitude: 4 }, rng())), 4, "noisy");
  });

  it("finds a dropout", () => {
    expectFault(withFault(5, (x) => injectFault(x, { kind: "dropout", from: faultFrom, magnitude: 0.3 }, rng())), 5, "dropout");
  });

  it("finds a saturated sensor", () => {
    expectFault(
      withFault(6, (x) => {
        const cap = quantile(quantize(x).subarray(baseline.from, baseline.to), 0.99);
        return Float64Array.from(x, (v, t) => (t >= faultFrom ? Math.min(v + 1.2, cap) : v));
      }),
      6,
      "saturated",
    );
  });

  it("finds a resolution change", () => {
    expectFault(withFault(7, (x) => injectFault(quantize(x), { kind: "resolution", from: faultFrom, magnitude: 8 }, rng())), 7, "resolution");
  });

  it("finds a timebase fault on every sensor", () => {
    const time = Float64Array.from({ length: n }, (_, t) => t * 180000);
    time[8000] = time[7999]!;
    const { results } = gate(makeGrid(cleanValues(), time));
    for (const r of results) {
      expect(r.value.health).toBe("timebase");
      expect(r.value.masked.length).toBe(1);
      expect(r.value.masked[0]!.from).toBeLessThanOrEqual(8000);
      expect(r.value.masked[0]!.to).toBeGreaterThan(8000);
      expect(r.value.masked[0]!.n).toBe(w);
    }
  });

  it("keeps a bias ramp, a gain ramp and a step healthy", () => {
    const values = cleanValues();
    values[0] = injectFault(values[0]!, { kind: "bias", from: faultFrom, magnitude: 5 }, rng());
    values[1] = injectFault(values[1]!, { kind: "gain", from: faultFrom, magnitude: 1.5 }, rng());
    values[2] = injectFault(values[2]!, { kind: "step", from: faultFrom, magnitude: 5 }, rng());
    const { results } = gate(makeGrid(values));
    for (const r of results) expect(r.value.health).toBe("healthy");
  });

  it("handles a sample-and-hold sensor in hold units", () => {
    const held = sampleAndHold(5, 7);
    const clean = makeGrid([held, ...cleanValues().slice(1)]);
    expect(fingerprint(clean.values[0]!, episodes).hold).toBe(5);
    expect(gate(clean).results[0]!.value.health).toBe("healthy");
    const flat = makeGrid([injectFault(held, { kind: "dead", from: faultFrom, magnitude: 0 }, rng()), ...cleanValues().slice(1)]);
    expectFault(flat, 0, "dead");
  });

  it("marks a constant sensor dead everywhere and leaves a sensor that changes after the baseline healthy", () => {
    const later = Float64Array.from({ length: n }, (_, t) => (t < 9000 ? 3 : 3 + Math.sin(t)));
    const { results, sink } = gate(makeGrid([new Float64Array(n).fill(3), later, ...cleanValues().slice(2)]));
    const changed = results[1]!;
    expect(changed.value.health).toBe("healthy");
    expect(changed.value.masked).toEqual([]);
    expect(changed.value.checks.every((c) => c.pass)).toBe(true);
    expect(sink.evidence.find((e) => e.id === changed.evidenceIds[0])!.method).toBe("constant-baseline");
    for (const r of results.slice(0, 1)) {
      expect(r.value.health).toBe("dead");
      expect(r.value.masked).toEqual([window(0, n)]);
      expect(r.mask.every((v) => v === 1)).toBe(true);
      expect(r.confidence).toBe(1);
      expect(r.value.checks.filter((c) => !c.pass).map((c) => c.check)).toEqual(["dead"]);
      expect(r.evidenceIds.length).toBe(1);
      expect(sink.evidence.find((e) => e.id === r.evidenceIds[0])!.chart.masks).toEqual([window(0, n)]);
    }
    expect(results[2]!.value.health).toBe("healthy");
  });
});

describe("calibrateHealth", () => {
  it("keeps false alarms at or below 1% on clean data and reports the detection table", () => {
    const grid = makeGrid(cleanValues());
    const fps = grid.values.map((x) => fingerprint(x, grid.episodes));
    const sink = createMemorySink("0123abcd");
    const r = calibrateHealth(grid, baseline, fps, sink, 1);
    expect(r.value.falseAlarmRate).toBeLessThanOrEqual(0.01);
    expect(r.value.targetFalseAlarmRate).toBe(0.01);
    expect(Object.keys(r.thresholds).sort()).toEqual(["deadRunFactor", "noisyRatio", "spikeSigma", "stuckNoiseRatio"]);
    expect([4, 5, 6, 8]).toContain(r.value.thresholds.spikeSigma);
    expect(r.value.thresholds.relationRho).toBe(0.3);
    expect(r.value.detection.map((d) => d.fault)).toEqual(["flatline", "spikes", "noise", "dropout", "gain", "resolution"]);
    const row = (fault: string) => r.value.detection.find((d) => d.fault === fault)!;
    expect(row("flatline").detected).toBe(true);
    expect(row("flatline").delay).toBeGreaterThan(0);
    expect(row("dropout").detected).toBe(true);
    expect(row("noise").detected).toBe(true);
    expect(row("gain").detected).toBe(false);
    expect(r.confidence).toBe(1);
    expect(r.evidenceIds.length).toBe(1);
    const ev = sink.evidence[0]!;
    expect(ev.kind).toBe("calibration");
    expect(ev.chart.type).toBe("bar");
    expect(ev.chart.bars!.length).toBe(6);
    expect(ev.stats.pairs).toBe(8 * 12);
    expect(Object.values(ev.stats).every(Number.isFinite)).toBe(true);
    const gated = healthGate(grid, baseline, fps, r.value.thresholds, createMemorySink("0123abcd"));
    expect(gated.every((h) => h.value.health === "healthy")).toBe(true);
  });
});

describe("proposeRules", () => {
  it("proposes three rules per continuous sensor with zero baseline violations", () => {
    const grid = makeGrid(cleanValues());
    const fps = grid.values.map((x) => fingerprint(x, grid.episodes));
    const sink = createMemorySink("0123abcd");
    const rules = proposeRules(grid, baseline, fps, defaultThresholds, sink);
    expect(rules.length).toBe(24);
    expect(rules.slice(0, 3).map((r) => r.value.rule.type)).toEqual(["range", "flatline", "missing"]);
    for (const r of rules) {
      expect(r.value.violations).toBe(0);
      expect(r.value.active).toBe(false);
      expect(r.value.rule.source).toBe(r.value.restated);
      expect(r.confidence).toBe(1);
      const ev = sink.evidence.find((e) => e.id === r.evidenceIds[0])!;
      expect(ev.kind).toBe("rule");
      expect(ev.stats.baselineViolations).toBe(0);
    }
    const flat = rules[1]!.value.rule;
    expect(flat.type === "flatline" && flat.maxDuration).toBe(5);
    const missing = rules[2]!.value.rule;
    expect(missing.type === "missing" && missing.maxMissingRate).toBe(0.05);
    expect(missing.type === "missing" && missing.windowSize).toBe(w);
    expect(rules[0]!.value.restated).toMatch(/^S01 must stay between -?\d+(\.\d+)? and -?\d+(\.\d+)?$/);
    expect(rules[1]!.value.restated).toBe("S01 must not stay flat for more than 5 samples");
    expect(rules[2]!.value.restated).toBe(`S01 must not be missing more than 5% in ${w} samples`);
  });

  it("counts planted violations on the whole grid", () => {
    const values = cleanValues();
    for (let t = 9000; t < 9011; t++) values[0]![t] = 50 + t / 100;
    values[1]!.fill(0.5, 9000, 9100);
    values[2]!.fill(NaN, 9000, 9100);
    const grid = makeGrid(values);
    const fps = grid.values.map((x) => fingerprint(x, grid.episodes));
    const rules = proposeRules(grid, baseline, fps, defaultThresholds, createMemorySink("0123abcd"));
    const of = (alias: string, type: string) => rules.find((r) => r.value.rule.sensor === alias && r.value.rule.type === type)!.value.violations;
    expect(of("S01", "range")).toBe(11);
    expect(of("S02", "flatline")).toBe(1);
    expect(of("S03", "missing")).toBe(1);
    expect(of("S01", "flatline")).toBe(0);
    expect(of("S02", "missing")).toBe(0);
    expect(of("S03", "range")).toBe(0);
  });
});
