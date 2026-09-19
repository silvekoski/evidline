import type { ChartSpec, Fingerprint, HealthClass, HealthValue, Thresholds, Window } from "@tpm/schemas";
import { hampel } from "./stats/hampel";
import { finiteSorted } from "./stats/quantile";
import { compressHold, longestRun, p99RunLength } from "./stats/runs";
import { noiseLevel, roundSig, stepSize } from "./stats/series";
import { window, type EvidenceSink, type Grid } from "./types";

export const defaultThresholds: Thresholds = {
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

const spikeShareFactor = 3;
const spikeShareFloor = 0.02;
const saturationFactor = 3;
const saturationDistinct = 20;
const resolutionFactor = 4;
const timebaseTolerance = 0.5;
const dropoutRateFloor = 0.01;
const hampelWindow = 7;

export type HealthCheck = HealthValue["checks"][number];

export type HealthResult = { value: HealthValue; claim: string; confidence: number; evidenceIds: string[]; mask: Uint8Array };

export type HealthBlockStats = { missing: number; run: number; noise: number; spikes: number[]; edge: number; step: number };

export type HealthReference = {
  hold: number;
  sigmas: number[];
  constant: boolean;
  distinct: number;
  missing: number;
  run: number;
  noise: number;
  spikes: number[];
  p1: number;
  p99: number;
  edge: number;
  stepRange: [number, number] | null;
};

type Rule = "above" | "below";

const checks: { check: HealthClass; rule: Rule }[] = [
  { check: "dropout", rule: "above" },
  { check: "dead", rule: "above" },
  { check: "stuck", rule: "below" },
  { check: "spikes", rule: "above" },
  { check: "saturated", rule: "above" },
  { check: "noisy", rule: "above" },
  { check: "timebase", rule: "below" },
  { check: "resolution", rule: "above" },
];

export function healthBlockSize(n: number): number {
  return Math.min(1024, Math.max(64, Math.floor(n / 64)));
}

function tile(from: number, to: number, size: number): Window[] {
  const count = Math.max(1, Math.floor((to - from) / size));
  return Array.from({ length: count }, (_, b) => window(from + b * size, b === count - 1 ? to : from + (b + 1) * size));
}

export function healthBlocks(grid: Grid): Window[] {
  const w = healthBlockSize(grid.n);
  return grid.episodes.flatMap((e) => tile(e.from, e.to, w));
}

export function mergeWindows(ws: Window[]): Window[] {
  const out: Window[] = [];
  for (const w of ws) {
    const last = out.at(-1);
    if (last && last.to === w.from) out[out.length - 1] = window(last.from, w.to);
    else out.push(w);
  }
  return out;
}

function finiteCount(x: Float64Array): number {
  let c = 0;
  for (const v of x) if (Number.isFinite(v)) c++;
  return c;
}

function share(flags: Uint8Array, count: number): number {
  let c = 0;
  for (const f of flags) c += f;
  return count > 0 ? c / count : 0;
}

function edgeMass(y: Float64Array, p1: number, p99: number, count: number): number {
  const edge: number[] = [];
  for (const v of y) if (Number.isFinite(v) && (v <= p1 || v >= p99)) edge.push(v);
  edge.sort((a, b) => a - b);
  let best = 0;
  for (let i = 0; i < edge.length; ) {
    let j = i + 1;
    while (j < edge.length && edge[j] === edge[i]) j++;
    best = Math.max(best, j - i);
    i = j;
  }
  return count > 0 ? best / count : 0;
}

function stepFactor(step: number, [lo, hi]: [number, number]): number {
  if (step === 0) return 1;
  return step > hi ? step / hi : step < lo ? lo / step : 1;
}

export function healthBlockStats(x: Float64Array, ref: Pick<HealthReference, "hold" | "sigmas" | "p1" | "p99">): HealthBlockStats {
  const y = ref.hold > 1 ? compressHold(x, ref.hold) : x;
  const count = finiteCount(y);
  return {
    missing: x.length > 0 ? 1 - finiteCount(x) / x.length : 0,
    run: longestRun(y),
    noise: noiseLevel(y),
    spikes: ref.sigmas.map((k) => share(hampel(y, hampelWindow, k), count)),
    edge: edgeMass(y, ref.p1, ref.p99, count),
    step: stepSize(y),
  };
}

export function healthReference(
  x: Float64Array,
  baseline: Window,
  episodes: Window[],
  hold: number,
  sigmas: number[],
  blockSize: number,
): HealthReference {
  const raw = x.subarray(baseline.from, baseline.to);
  const y = hold > 1 ? compressHold(raw, hold) : raw;
  const clipped = episodes.flatMap((e) => {
    const from = Math.max(e.from, baseline.from) - baseline.from;
    const to = Math.min(e.to, baseline.to) - baseline.from;
    return to > from ? [[from, to]] : [];
  });
  const cut = (v: number) => Math.min(y.length, Math.round(v / hold));
  const spans = clipped.flatMap(([from, to], k) => {
    const w = window(cut(from!), k === clipped.length - 1 ? y.length : cut(to!));
    return w.n > 0 ? [w] : [];
  });
  const sorted = finiteSorted(y);
  const count = sorted.length;
  const limit = Math.max(saturationDistinct, Math.floor(count / 2) + 1);
  let distinct = count > 0 ? 1 : 0;
  for (let i = 1; i < count && distinct < limit; i++) if (sorted[i] !== sorted[i - 1]) distinct++;
  const p1 = count > 0 ? sorted[Math.ceil(0.01 * (count - 1))]! : 0;
  const p99 = count > 0 ? sorted[Math.floor(0.99 * (count - 1))]! : 0;
  const blocks = spans
    .flatMap((s) => tile(s.from, s.to, Math.max(2, Math.floor(blockSize / hold))))
    .map((b) => healthBlockStats(y.subarray(b.from, b.to), { hold: 1, sigmas, p1, p99 }));
  const steps = distinct > 1 && distinct < count / 2 ? blocks.map((b) => b.step).filter((s) => s > 0) : [];
  return {
    hold,
    sigmas,
    constant: distinct <= 1,
    distinct,
    missing: raw.length > 0 ? 1 - finiteCount(raw) / raw.length : 0,
    run: p99RunLength(y, spans),
    noise: noiseLevel(y, spans),
    spikes: sigmas.map((_, i) => Math.max(0, ...blocks.map((b) => b.spikes[i]!))),
    p1,
    p99,
    edge: Math.max(0, ...blocks.map((b) => b.edge)),
    stepRange: steps.length > 0 ? [Math.min(...steps), Math.max(...steps)] : null,
  };
}

function passes(rule: Rule, statistic: number, threshold: number): boolean {
  return threshold === 0 || (rule === "above" ? statistic <= threshold : statistic >= threshold);
}

export function evaluateHealth(b: HealthBlockStats, ref: HealthReference, th: Thresholds, timebase: number): HealthCheck[] {
  const sigma = ref.sigmas.indexOf(th.spikeSigma);
  if (sigma < 0) throw new Error(`spikeSigma ${th.spikeSigma} is not in the reference`);
  const values: Record<HealthClass, [number, number]> = {
    dropout: [b.missing, th.dropoutRateFactor * Math.max(dropoutRateFloor, ref.missing)],
    dead: [b.run, th.deadRunFactor * (ref.constant ? 1 : ref.run)],
    stuck: [b.noise, th.stuckNoiseRatio * ref.noise],
    spikes: [b.spikes[sigma]!, Math.max(spikeShareFloor, spikeShareFactor * ref.spikes[sigma]!)],
    saturated: [ref.distinct >= saturationDistinct ? b.edge : 0, Math.max(th.saturationShare, saturationFactor * ref.edge)],
    noisy: [b.noise, th.noisyRatio * ref.noise],
    timebase: [timebase, timebaseTolerance],
    resolution: [ref.stepRange ? stepFactor(b.step, ref.stepRange) : 1, resolutionFactor],
  };
  return checks.map(({ check, rule }) => {
    const [statistic, threshold] = values[check];
    return { check, statistic, threshold, pass: passes(rule, statistic, threshold) };
  });
}

function ratio(statistic: number, threshold: number): number {
  return threshold === 0 ? 1 : statistic / threshold;
}

export function checkMargin(c: HealthCheck): number {
  const r = ratio(c.statistic, c.threshold);
  return r > 0 ? Math.min(1, Math.abs(Math.log2(r))) : 1;
}

export function timeRegularity(grid: Grid, b: Window): number {
  const { time, dt } = grid;
  if (!time || !dt) return 1;
  let worst = 1;
  for (let t = b.from + 1; t < b.to; t++) {
    const step = time[t]! - time[t - 1]!;
    worst = Math.min(worst, step > 0 ? Math.min(step / dt, dt / step) : 0);
  }
  return worst;
}

function sig(x: number): string {
  return String(roundSig(x));
}

export function plantWideFloor(sensors: number): number {
  return Math.max(3, Math.ceil(0.1 * sensors));
}

export function healthGate(grid: Grid, baseline: Window, fps: Fingerprint[], thresholds: Thresholds, sink: EvidenceSink): HealthResult[] {
  const { n, aliases, episodes } = grid;
  const w = healthBlockSize(n);
  const blocks = healthBlocks(grid);
  const regularity = blocks.map((b) => timeRegularity(grid, b));
  const whole = window(0, n);
  const refs = aliases.map((_, i) => healthReference(grid.values[i]!, baseline, episodes, fps[i]!.hold, [thresholds.spikeSigma], w));
  const evaluated = refs.map((ref, i) =>
    ref.constant ? null : blocks.map((b, k) => evaluateHealth(healthBlockStats(grid.values[i]!.subarray(b.from, b.to), ref), ref, thresholds, regularity[k]!)),
  );
  const noisy = checks.findIndex((c) => c.check === "noisy");
  const floor = plantWideFloor(evaluated.filter((e) => e !== null).length);
  const noisyCount = blocks.map((_, k) => evaluated.filter((e) => e !== null && !e[k]![noisy]!.pass).length);
  const plantWide = noisyCount.map((count) => count >= floor);
  for (const e of evaluated) {
    if (!e) continue;
    e.forEach((entries, k) => {
      if (plantWide[k]) entries[noisy] = { ...entries[noisy]!, pass: true };
    });
  }

  return aliases.map((alias, i) => {
    const x = grid.values[i]!;
    const ref = refs[i]!;
    const chart = (masks: Window[]): ChartSpec => ({
      type: "line",
      window: whole,
      series: [{ key: alias, label: alias, source: { sensor: alias }, style: "solid" }],
      band: { lo: ref.p1, hi: ref.p99, label: "baseline p1 to p99" },
      marks: [{ at: baseline.to, label: `baseline end ${baseline.to}`, kind: "boundary" }],
      masks,
    });
    const evidence = (c: HealthCheck, masks: Window[], failedBlocks: number) => {
      const from = masks[0]!.from;
      const to = masks.at(-1)!.to;
      const covered = masks.reduce((s, m) => s + m.n, 0);
      return sink.add({
        kind: "health",
        sensors: [alias],
        window: window(from, to),
        method: c.check,
        stats: { n: to - from, statistic: c.statistic, threshold: c.threshold, ratio: ratio(c.statistic, c.threshold), blocks: failedBlocks, share: covered / n },
        verdict: `${alias} fails the ${c.check} check in ${failedBlocks} of ${blocks.length} blocks: statistic ${sig(c.statistic)} against threshold ${sig(c.threshold)}.`,
        chart: chart(masks),
      });
    };

    if (ref.constant) {
      const dead: HealthCheck = { check: "dead", statistic: longestRun(x, episodes), threshold: thresholds.deadRunFactor, pass: false };
      const value: HealthValue = {
        sensor: alias,
        health: "dead",
        masked: [whole],
        checks: checks.map(({ check }) => (check === "dead" ? dead : { check, statistic: 0, threshold: 0, pass: true })),
      };
      return {
        value,
        claim: `${alias} is constant in the baseline, so it counts as dead everywhere and every window is masked.`,
        confidence: checkMargin(dead),
        evidenceIds: [evidence(dead, [whole], blocks.length)],
        mask: new Uint8Array(n).fill(1),
      };
    }

    const perBlock = evaluated[i]!;
    const summary = checks.map(({ check, rule }, c) => {
      const counted = c === noisy && plantWide.some((p) => !p) ? perBlock.filter((_, k) => !plantWide[k]) : perBlock;
      const entries = counted.map((e) => e[c]!);
      const statistic = entries.reduce((acc, e) => (rule === "below" ? Math.min(acc, e.statistic) : Math.max(acc, e.statistic)), entries[0]!.statistic);
      return { check, statistic, threshold: entries[0]!.threshold, pass: perBlock.every((e) => e[c]!.pass) };
    });
    const shared = blocks.flatMap((_, k) => (plantWide[k] && perBlock[k]![noisy]!.statistic > perBlock[k]![noisy]!.threshold ? [k] : []));
    const sharedNote =
      shared.length > 0
        ? ` Noise rises in ${shared.length} block${shared.length === 1 ? "" : "s"} together with at least ${Math.min(...shared.map((k) => noisyCount[k]!)) - 1} other sensors: a plant-wide change, not a sensor fault.`
        : "";
    const masked = mergeWindows(blocks.filter((_, k) => perBlock[k]!.some((e) => !e.pass)));
    const mask = new Uint8Array(n);
    for (const m of masked) mask.fill(1, m.from, m.to);
    const failed = summary.filter((c) => !c.pass);
    const decisive = failed[0];

    if (!decisive) {
      const stats: Record<string, number> = { n, blocks: blocks.length, blockSize: w, sharedNoiseBlocks: shared.length };
      for (const c of summary) {
        stats[c.check] = c.statistic;
        stats[`${c.check}Limit`] = c.threshold;
      }
      const applicable = summary.filter((c) => c.threshold > 0);
      const closest = applicable.reduce((a, c) => (checkMargin(c) < checkMargin(a) ? c : a), applicable[0] ?? summary[0]!);
      return {
        value: { sensor: alias, health: "healthy", masked: [], checks: summary },
        claim: `${alias} passes all ${checks.length} health checks on ${blocks.length} blocks of ${w} samples; the closest check is ${closest.check} at ${sig(closest.statistic)} against ${sig(closest.threshold)}.${sharedNote}`,
        confidence: applicable.length > 0 ? checkMargin(closest) : 1,
        evidenceIds: [
          sink.add({
            kind: "health",
            sensors: [alias],
            window: whole,
            method: "health-gate",
            stats,
            verdict: `${alias} passes all ${checks.length} health checks on ${blocks.length} blocks.`,
            chart: chart([]),
          }),
        ],
        mask,
      };
    }

    const evidenceIds = failed.map((c) => {
      const bad = blocks.filter((_, k) => !perBlock[k]![summary.indexOf(c)]!.pass);
      return evidence(c, mergeWindows(bad), bad.length);
    });
    const others = failed.slice(1).map((c) => c.check);
    const coveredShare = masked.reduce((s, m) => s + m.n, 0) / n;
    return {
      value: { sensor: alias, health: decisive.check, masked, checks: summary },
      claim:
        `${alias} fails the ${decisive.check} check in ${masked.length} window${masked.length === 1 ? "" : "s"} covering ${sig(100 * coveredShare)}% of the grid: ` +
        `statistic ${sig(decisive.statistic)} against threshold ${sig(decisive.threshold)}.` +
        (others.length > 0 ? ` Also failed: ${others.join(", ")}.` : "") +
        sharedNote,
      confidence: checkMargin(decisive),
      evidenceIds,
      mask,
    };
  });
}
