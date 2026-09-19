import { Fingerprint as FingerprintSchema } from "@tpm/schemas";
import { describe, expect, it } from "vitest";
import { classifySignal, fingerprint } from "../src/fingerprint";
import { gaussian, mulberry32 } from "../src/random";
import { window } from "../src/types";

const whole = (n: number) => [window(0, n)];

function noise(n: number, seed: number, sigma = 1): Float64Array {
  const rng = mulberry32(seed);
  return Float64Array.from({ length: n }, () => sigma * gaussian(rng));
}

function dwell(n: number, seed: number, levels: number): Float64Array {
  const rng = mulberry32(seed);
  const out = new Float64Array(n);
  for (let i = 0; i < n; ) {
    const len = 20 + Math.floor(rng() * 60);
    out.fill(Math.floor(rng() * levels), i, Math.min(n, i + len));
    i += len;
  }
  return out;
}

function sampleAndHold(n: number, hold: number, seed: number): Float64Array {
  const rng = mulberry32(seed);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i += hold) out.fill(gaussian(rng), i, Math.min(n, i + hold));
  return out;
}

function finiteNumbers(fp: ReturnType<typeof fingerprint>): number[] {
  return [
    fp.n,
    fp.missingRate,
    ...Object.values(fp.quantiles),
    fp.mad,
    ...fp.histogram.edges,
    ...fp.histogram.shares,
    fp.step,
    fp.hold,
    fp.noise,
    fp.acfTime,
    fp.flatShare,
    fp.monotonicShare,
    fp.distinct,
  ];
}

describe("classifySignal", () => {
  it("applies the rules in order", () => {
    const base = { distinct: 100, flatShare: 0, monotonicShare: 0, acfTime: 1 };
    expect(classifySignal({ ...base, distinct: 1 })).toBe("constant");
    expect(classifySignal({ ...base, distinct: 2 })).toBe("binary");
    expect(classifySignal({ ...base, distinct: 5, flatShare: 0.95 })).toBe("state");
    expect(classifySignal({ ...base, distinct: 5, flatShare: 0.5, monotonicShare: 1 })).toBe("counter");
    expect(classifySignal({ ...base, monotonicShare: 0.99, flatShare: 0.7 })).toBe("counter");
    expect(classifySignal({ ...base, flatShare: 0.7 })).toBe("step");
    expect(classifySignal({ ...base, acfTime: 21 })).toBe("slow");
    expect(classifySignal(base)).toBe("fast");
  });
});

describe("fingerprint signal types", () => {
  it("constant", () => {
    const fp = fingerprint(new Float64Array(2000).fill(7), whole(2000));
    expect(fp.signalType).toBe("constant");
    expect(fp.distinct).toBe(1);
    expect(fp.mad).toBe(0);
    expect(fp.noise).toBe(0);
    expect(fp.step).toBe(0);
  });

  it("binary", () => {
    const rng = mulberry32(1);
    const x = Float64Array.from({ length: 2000 }, () => (rng() < 0.3 ? 1 : 0));
    const fp = fingerprint(x, whole(2000));
    expect(fp.signalType).toBe("binary");
    expect(fp.distinct).toBe(2);
    expect(fp.step).toBe(1);
  });

  it("state", () => {
    const fp = fingerprint(dwell(4000, 2, 4), whole(4000));
    expect(fp.signalType).toBe("state");
    expect(fp.distinct).toBeLessThanOrEqual(4);
    expect(fp.flatShare).toBeGreaterThan(0.9);
    expect(fp.hold).toBe(1);
  });

  it("counter", () => {
    const x = Float64Array.from({ length: 3000 }, (_, i) => i);
    const fp = fingerprint(x, whole(3000));
    expect(fp.signalType).toBe("counter");
    expect(fp.monotonicShare).toBe(1);
    expect(fp.step).toBe(1);
  });

  it("step", () => {
    const fp = fingerprint(dwell(4000, 3, 30), whole(4000));
    expect(fp.signalType).toBe("step");
    expect(fp.distinct).toBeGreaterThan(8);
    expect(fp.flatShare).toBeGreaterThan(0.6);
  });

  it("slow with acfTime scaled back to grid samples", () => {
    const n = 20000;
    const x = Float64Array.from({ length: n }, (_, t) => Math.sin((2 * Math.PI * t) / 2000));
    const fp = fingerprint(x, whole(n));
    expect(fp.signalType).toBe("slow");
    expect(fp.acfTime).toBeGreaterThan(20);
    expect(fp.acfTime % 3).toBe(0);
    expect(Math.abs(fp.period! - 2000)).toBeLessThanOrEqual(20);
  });

  it("fast", () => {
    const fp = fingerprint(noise(4000, 4), whole(4000));
    expect(fp.signalType).toBe("fast");
    expect(fp.acfTime).toBe(1);
    expect(fp.period).toBeNull();
    expect(fp.hold).toBe(1);
    expect(fp.flatShare).toBe(0);
    expect(fp.noise).toBeGreaterThan(0.8);
    expect(fp.noise).toBeLessThan(1.2);
  });
});

describe("fingerprint hold and missing values", () => {
  it("a sample-and-hold signal gives hold 2 and 5 and a finite noise", () => {
    for (const hold of [2, 5]) {
      const fp = fingerprint(sampleAndHold(2000, hold, 10 + hold), whole(2000));
      expect(fp.hold).toBe(hold);
      expect(Number.isFinite(fp.noise)).toBe(true);
      expect(fp.noise).toBeGreaterThan(0.7);
      expect(fp.noise).toBeLessThan(1.3);
      expect(fp.flatShare).toBe(0);
      expect(fp.signalType).toBe("fast");
    }
  });

  it("counts missing values and keeps every number finite", () => {
    const x = noise(5000, 20);
    for (let t = 0; t < 5000; t += 10) x[t] = NaN;
    const fp = fingerprint(x, [window(0, 2500), window(2500, 5000)]);
    expect(fp.n).toBe(5000);
    expect(fp.missingRate).toBe(0.1);
    expect(fp.distinct).toBe(4500);
    expect(finiteNumbers(fp).every(Number.isFinite)).toBe(true);
    expect(fp.histogram.shares.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 9);
    expect(FingerprintSchema.safeParse(fp).success).toBe(true);
  });

  it("survives an all-missing series", () => {
    const fp = fingerprint(new Float64Array(500).fill(NaN), whole(500));
    expect(fp.missingRate).toBe(1);
    expect(fp.distinct).toBe(0);
    expect(fp.signalType).toBe("constant");
    expect(fp.period).toBeNull();
    expect(finiteNumbers(fp).every(Number.isFinite)).toBe(true);
    expect(FingerprintSchema.safeParse(fp).success).toBe(true);
  });
});
