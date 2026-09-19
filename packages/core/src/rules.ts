import type { Fingerprint, RuleJson, RuleValue, Thresholds, Window } from "@tpm/schemas";
import { healthBlockSize } from "./health";
import { finiteSorted, mad, quantile, quantileSorted } from "./stats/quantile";
import { compressHold, p99RunLength, runLengths } from "./stats/runs";
import { roundSig } from "./stats/series";
import { window, type EvidenceSink, type Grid } from "./types";

export type RuleResult = { value: RuleValue; claim: string; confidence: number; evidenceIds: string[] };

function sig(x: number): string {
  return String(roundSig(x));
}

function bounds(min: number | undefined, max: number | undefined): string {
  if (min !== undefined && max !== undefined) return `between ${sig(min)} and ${sig(max)}`;
  return max !== undefined ? `below ${sig(max)}` : `above ${sig(min ?? 0)}`;
}

export function restateRule(rule: RuleJson): string {
  const s = rule.sensor;
  switch (rule.type) {
    case "range":
      return `${s} must stay ${bounds(rule.min, rule.max)}`;
    case "flatline":
      return `${s} must not stay flat for more than ${rule.maxDuration} samples`;
    case "rate":
      return `${s} must not change faster than ${sig(rule.maxRate)} per sample`;
    case "relation":
      return rule.relation === "leads"
        ? `${s} must lead ${rule.sensor2} by ${rule.lag ?? 0} samples within ${sig(rule.tolerance)}`
        : `${s} must ${rule.relation === "tracks" ? "track" : "equal"} ${rule.sensor2} within ${sig(rule.tolerance)}`;
    case "missing":
      return `${s} must not be missing more than ${sig(100 * rule.maxMissingRate)}% in ${rule.windowSize} samples`;
    case "aggregate":
      return `${rule.agg} of ${s} over ${rule.windowSize} samples must stay ${bounds(rule.min, rule.max)}`;
  }
}

function windows(w: Window, size: number): Window[] {
  const count = Math.floor(w.n / size);
  return count === 0 ? [w] : Array.from({ length: count }, (_, k) => window(w.from + k * size, w.from + (k + 1) * size));
}

function aggregate(x: Float64Array, agg: "mean" | "median" | "min" | "max" | "std"): number {
  const s = finiteSorted(x);
  if (s.length === 0) return NaN;
  if (agg === "median") return quantileSorted(s, 0.5);
  if (agg === "min") return s[0]!;
  if (agg === "max") return s[s.length - 1]!;
  let sum = 0;
  for (const v of s) sum += v;
  const mean = sum / s.length;
  if (agg === "mean") return mean;
  let sq = 0;
  for (const v of s) sq += (v - mean) ** 2;
  return Math.sqrt(sq / s.length);
}

function outside(v: number, min: number | undefined, max: number | undefined): boolean {
  return Number.isFinite(v) && ((min !== undefined && v < min) || (max !== undefined && v > max));
}

export function countViolations(rule: RuleJson, grid: Grid, w: Window): number {
  const x = grid.values[grid.aliases.indexOf(rule.sensor)];
  if (!x) return 0;
  let count = 0;
  switch (rule.type) {
    case "range":
      for (let t = w.from; t < w.to; t++) if (outside(x[t]!, rule.min, rule.max)) count++;
      break;
    case "flatline":
      for (const len of runLengths(x.subarray(w.from, w.to)).lengths) if (len > rule.maxDuration) count++;
      break;
    case "rate":
      for (let t = w.from + 1; t < w.to; t++) if (Math.abs(x[t]! - x[t - 1]!) > rule.maxRate) count++;
      break;
    case "relation": {
      const y = grid.values[grid.aliases.indexOf(rule.sensor2)];
      if (!y) return 0;
      const lag = rule.lag ?? 0;
      for (let t = w.from; t < w.to; t++) {
        const a = rule.relation === "leads" ? x[t - lag] : x[t];
        const b = rule.relation === "leads" ? y[t] : y[t - lag];
        if (a !== undefined && b !== undefined && Math.abs(a - b) > rule.tolerance) count++;
      }
      break;
    }
    case "missing":
      for (const b of windows(w, rule.windowSize)) {
        let missing = 0;
        for (let t = b.from; t < b.to; t++) if (!Number.isFinite(x[t])) missing++;
        if (missing / b.n > rule.maxMissingRate) count++;
      }
      break;
    case "aggregate":
      for (const b of windows(w, rule.windowSize)) if (outside(aggregate(x.subarray(b.from, b.to), rule.agg), rule.min, rule.max)) count++;
      break;
  }
  return count;
}

export function proposeRules(grid: Grid, baseline: Window, fps: Fingerprint[], thresholds: Thresholds, sink: EvidenceSink): RuleResult[] {
  const { n, aliases } = grid;
  const whole = window(0, n);
  const w = healthBlockSize(n);
  return aliases.flatMap((alias, i) => {
    const fp = fps[i]!;
    if (fp.signalType !== "slow" && fp.signalType !== "fast") return [];
    const x = grid.values[i]!;
    const raw = x.subarray(baseline.from, baseline.to);
    const scale = mad(raw);
    const p1 = quantile(raw, 0.01);
    const p99 = quantile(raw, 0.99);
    let missing = 0;
    for (const v of raw) if (!Number.isFinite(v)) missing++;
    const held = fp.hold > 1 ? compressHold(raw, fp.hold) : raw;
    const run = p99RunLength(held) * fp.hold;
    const min = p1 - 3 * scale;
    const max = p99 + 3 * scale;
    const maxMissingRate = Math.min(1, Math.max(0.05, (thresholds.dropoutRateFactor * missing) / Math.max(1, raw.length)));
    const maxDuration = Math.max(1, Math.round(thresholds.deadRunFactor * run));
    const drafts: { rule: RuleJson; params: Record<string, number> }[] = [
      { rule: { type: "range", sensor: alias, source: "", min, max }, params: { min, max } },
      { rule: { type: "flatline", sensor: alias, source: "", maxDuration }, params: { maxDuration } },
      { rule: { type: "missing", sensor: alias, source: "", maxMissingRate, windowSize: w }, params: { maxMissingRate, windowSize: w } },
    ];
    return drafts.map(({ rule: draft, params }) => {
      const restated = restateRule(draft);
      const rule = { ...draft, source: restated };
      const violations = countViolations(rule, grid, whole);
      const baselineViolations = countViolations(rule, grid, baseline);
      const evidenceId = sink.add({
        kind: "rule",
        sensors: [alias],
        window: whole,
        method: rule.type,
        stats: { n, violations, baselineViolations, ...params },
        verdict: `${restated}: ${violations} violations on the whole grid, ${baselineViolations} in the baseline.`,
        chart: {
          type: "line",
          window: whole,
          series: [{ key: alias, label: alias, source: { sensor: alias }, style: "solid" }],
          ...(rule.type === "range" ? { band: { lo: min, hi: max, label: "rule range" } } : {}),
          marks: [{ at: baseline.to, label: `baseline end ${baseline.to}`, kind: "boundary" }],
        },
      });
      return {
        value: { rule, restated, violations, active: false },
        claim: `Proposed ${rule.type} rule: ${restated}. ${violations} violations on the whole grid, ${baselineViolations} in the baseline.`,
        confidence: 1,
        evidenceIds: [evidenceId],
      };
    });
  });
}
