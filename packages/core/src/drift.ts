import type { ChartSeries, DriftValue, Fingerprint, Overrides, RoleValue, Thresholds, Window } from "@tpm/schemas";
import { fitPeerModel, maskedValues, type PeerModel, type PeerPrediction } from "./peer-model";
import type { Peer, RelationGraph } from "./relations";
import {
  blockMedians,
  cusum,
  finiteSorted,
  histogram,
  mad,
  mannKendall,
  median,
  quantileSorted,
  roundSig,
  theilSen,
  type CusumAlarm,
} from "./stats";
import { window, type EvidenceSink, type Grid, type Masks } from "./types";

export type DriftThresholds = Pick<Thresholds, "cusumH" | "cusumK" | "deviationLimit" | "distributionLimit">;

export const defaultDriftThresholds: DriftThresholds = { cusumH: 20, cusumK: 0.5, deviationLimit: 3, distributionLimit: 20 };

export type DriftModel = PeerModel & PeerPrediction;

type Path = { model: DriftModel | null; ref: DistanceReference | null; series: Float64Array | null; blockSize: number; fine: number; h: number };

export type DriftResult = {
  value: DriftValue;
  claim: string;
  confidence: number;
  evidenceIds: string[];
  model: DriftModel | null;
  victimOf: string | null;
  drifting: boolean;
};

export type RoleLike = { value: Pick<RoleValue, "sensor" | "role"> };

export function isContinuous(fp: Fingerprint): boolean {
  return fp.signalType === "slow" || fp.signalType === "fast" || fp.signalType === "step";
}

export function driftBlock(grid: Grid): number {
  const day = grid.dt ? Math.round(86_400_000 / grid.dt) : 0;
  return day >= 20 ? day : Math.max(1, Math.floor(grid.n / 200));
}

export function distanceWindow(n: number): { w: number; stride: number } {
  const w = Math.min(Math.max(Math.round(n / 40), 50), 5000);
  return { w, stride: Math.max(1, Math.floor(w / 4)) };
}

export function clipEpisodes(episodes: Window[], from: number, to: number): Window[] {
  return episodes
    .filter((e) => e.to > from && e.from < to)
    .map((e) => window(Math.max(e.from, from) - from, Math.min(e.to, to) - from));
}

export type BlockStats = {
  centers: number[];
  medians: number[];
  maxDeviation: number;
  slope: number;
  z: number;
  p: number;
};

export function fineBlock(n: number): number {
  return Math.max(1, Math.floor(n / 200));
}

export function blockStats(series: Float64Array, from: number, to: number, block: number, fine = block): BlockStats {
  const { centers, medians } = blockMedians(series, block, from, to);
  let maxDeviation = 0;
  for (const m of fine === block ? medians : blockMedians(series, fine, from, to).medians) maxDeviation = Math.max(maxDeviation, Math.abs(m));
  const y = Float64Array.from(medians);
  const { slope } = theilSen(y, Float64Array.from(centers));
  const { z, p } = mannKendall(y);
  return { centers, medians, maxDeviation, slope, z, p };
}

export function isDrifting(stats: BlockStats, alarm: CusumAlarm | null, limit: number): boolean {
  return stats.maxDeviation >= limit && (stats.p < 0.01 || alarm !== null);
}

export function detectionIndex(stats: BlockStats, alarm: CusumAlarm | null, limit: number): number | null {
  if (alarm) return alarm.index;
  const i = stats.medians.findIndex((m) => Math.abs(m) >= limit);
  return i < 0 ? null : Math.round(stats.centers[i]!);
}

export type DistanceReference = { quantiles: Float64Array; scale: number; center: number; spread: number; w: number; stride: number };

function referenceQuantiles(y: Float64Array, parts: Window[], thin: number): Float64Array {
  const values: number[] = [];
  for (const { from, to } of parts) for (let t = from; t < to; t += thin) if (Number.isFinite(y[t])) values.push(y[t]!);
  const sorted = Float64Array.from(values).sort();
  return Float64Array.from({ length: 200 }, (_, i) => quantileSorted(sorted, (i + 0.5) / 200));
}

export function rollingDistance(y: Float64Array, ref: DistanceReference): Float64Array {
  const out = new Float64Array(y.length).fill(NaN);
  for (let end = ref.w; end <= y.length; end += ref.stride) {
    const sorted = finiteSorted(y.subarray(end - ref.w, end));
    if (sorted.length < ref.w / 2) continue;
    let total = 0;
    for (let i = 0; i < 200; i++) total += Math.abs(quantileSorted(sorted, (i + 0.5) / 200) - ref.quantiles[i]!);
    out[end - 1] = (total / 200 / ref.scale - ref.center) / ref.spread;
  }
  return out;
}

export function distanceReference(y: Float64Array, parts: Window[], w: number, stride: number, step: number, thin = 1): DistanceReference {
  const quantiles = referenceQuantiles(y, parts, thin);
  const raw: DistanceReference = { quantiles, scale: Math.max(mad(quantiles), step) || 1, center: 0, spread: 1, w, stride };
  const distances: number[] = [];
  for (const { from, to } of parts) for (const d of rollingDistance(y.subarray(from, to), raw)) if (Number.isFinite(d)) distances.push(d);
  const series = Float64Array.from(distances);
  const center = distances.length > 0 ? median(series) : 0;
  return { ...raw, center, spread: Math.max(distances.length > 0 ? mad(series, center) : 0, 0.5) };
}

function maskWindows(mask: Uint8Array | undefined): Window[] {
  const out: Window[] = [];
  if (!mask) return out;
  for (let t = 0; t < mask.length; ) {
    if (mask[t] !== 1) {
      t++;
      continue;
    }
    let end = t;
    while (end < mask.length && mask[end] === 1) end++;
    out.push(window(t, end));
    t = end;
  }
  return out;
}

type Draft = {
  index: number;
  alias: string;
  peers: Peer[];
  model: DriftModel | null;
  stats: BlockStats;
  alarm: CusumAlarm | null;
  inRange: boolean;
  evidenceIds: string[];
  responsible: string | null;
  victimOf: string | null;
  drifting: boolean;
};

export function detectDrift(
  grid: Grid,
  masks: Masks,
  graph: RelationGraph,
  roles: RoleLike[],
  baseline: Window,
  fps: Fingerprint[],
  thresholds: DriftThresholds,
  sink: EvidenceSink,
  overrides: Overrides = {},
): DriftResult[] {
  const { n, episodes } = grid;
  const limit = thresholds.deviationLimit;
  const block = driftBlock(grid);
  const fine = fineBlock(n);
  const { w, stride } = distanceWindow(n);
  const skip = new Set(roles.filter((r) => r.value.role === "counter" || r.value.role === "state").map((r) => r.value.sensor));
  const groupOf = new Map<string, Set<string>>();
  for (const g of graph.groups) for (const a of g.sensors) groupOf.set(a, new Set(g.sensors));
  const allPeersOf = (alias: string): Peer[] => (graph.peers.get(alias) ?? []).filter((p) => p.alias !== alias && grid.aliases.includes(p.alias));
  const chosenPeers = new Map<string, Peer[]>();
  const peersOf = (alias: string): Peer[] => chosenPeers.get(alias) ?? allPeersOf(alias);
  const deviations = new Map<string, Float64Array>();
  const deviationWithout = (index: number, without: string): Float64Array => {
    const peers = peersOf(grid.aliases[index]!).filter((p) => p.alias !== without);
    const key = `${index}:${peers.map((p) => p.alias).join(",")}`;
    let series = deviations.get(key);
    if (series === undefined) {
      series = fitPeerModel(grid, index, peers, baseline, masks).predict(grid, masks).deviation;
      deviations.set(key, series);
    }
    return series;
  };
  const isolationWindow = (d: Draft): Window => (d.alarm ? window(d.alarm.onset, Math.min(n, d.alarm.index + 2 * block)) : window(baseline.to, n));
  const flatWithout = (index: number, without: string, iso: Window): boolean =>
    blockStats(deviationWithout(index, without), iso.from, iso.to, block, fine).maxDeviation < limit;
  const full = window(0, n);
  const after = window(baseline.to, n);
  const drafts: Draft[] = [];

  for (let i = 0; i < grid.aliases.length; i++) {
    const alias = grid.aliases[i]!;
    const fp = fps[i]!;
    if (!isContinuous(fp) || skip.has(alias)) continue;
    const y = maskedValues(grid, masks, i);
    const baseSorted = finiteSorted(y.subarray(baseline.from, baseline.to));
    if (baseSorted.length < 100) continue;
    const p1 = quantileSorted(baseSorted, 0.01);
    const p99 = quantileSorted(baseSorted, 0.99);
    const evaluate = (path: Path) => {
      const series = path.series ?? rollingDistance(y, path.ref as DistanceReference);
      const stats = blockStats(series, baseline.to, n, path.blockSize, path.fine);
      const c = cusum(series, thresholds.cusumK, path.h, { start: baseline.to, episodes });
      const alarm = c.alarms[0] ?? null;
      return { path, series, stats, c, alarm, drifting: isDrifting(stats, alarm, limit) };
    };
    const distancePath = (): Path => ({ model: null, ref: distanceReference(y, [baseline], w, stride, fp.step), series: null, blockSize: Math.max(block, w), fine: Math.max(block, w), h: thresholds.distributionLimit });
    const peerRun = (candidates: Peer[]) => {
      const fitted = candidates.length > 0 ? fitPeerModel(grid, i, candidates, baseline, masks) : null;
      const m: DriftModel | null = fitted && fitted.peers.length > 0 ? { ...fitted, ...fitted.predict(grid, masks) } : null;
      return m ? evaluate({ model: m, ref: null, series: m.deviation, blockSize: block, fine, h: thresholds.cusumH }) : null;
    };
    const every = allPeersOf(alias);
    const outside = every.filter((q) => !groupOf.get(alias)?.has(q.alias));
    const runs = [peerRun(every), outside.length < every.length ? peerRun(outside) : null, evaluate(distancePath())];
    const chosen = runs.find((r) => r?.drifting) ?? runs.find((r) => r !== null)!;
    const peers = chosen.path.model ? (chosen === runs[1] ? outside : every) : [];
    chosenPeers.set(alias, peers);
    const model = chosen.path.model;
    const { path, series, stats, c, alarm, drifting } = chosen;
    const checkedTo = drifting && alarm ? alarm.index + 1 : n;
    const lastValues = finiteSorted(y.subarray(Math.max(0, checkedTo - block), checkedTo));
    const lastMedian = quantileSorted(lastValues, 0.5);
    const inRange = lastValues.length > 0 && lastMedian >= p1 && lastMedian <= p99;
    const stayed = stats.maxDeviation < limit;
    const evidenceIds: string[] = [];
    const chart = {
      window: full,
      band: { lo: p1, hi: p99, label: "baseline p1 to p99" },
      marks: drifting && alarm ? [{ at: alarm.onset, label: `onset ${alarm.onset}`, kind: "onset" as const }] : [],
      masks: maskWindows(masks[i]),
      threshold: limit,
    };
    const valueSeries: ChartSeries = { key: "value", label: alias, source: { sensor: alias }, style: "solid" };
    const commonStats = { maxDeviation: stats.maxDeviation, deviationLimit: limit, p1, p99, inRange: inRange ? 1 : 0 };

    if (path.model) {
      deviations.set(`${i}:${peers.map((p) => p.alias).join(",")}`, path.model.deviation);
      const { expected, deviation } = path.model;
      const peerSeries = path.model.peers.map(
        (p): ChartSeries => ({ key: p.alias, label: `${p.alias} (lag ${p.lag})`, source: { sensor: p.alias }, style: "thin" }),
      );
      evidenceIds.push(
        sink.add(
          {
            kind: "residual",
            sensors: [alias, ...path.model.peers.map((p) => p.alias)],
            window: full,
            method: "huber-regression",
            stats: { n: path.model.n, peers: path.model.peers.length, sigma: path.model.sigma, ...commonStats },
            verdict: `${alias} ${stayed ? "stays within" : "leaves"} ${roundSig(limit)} sigma of its ${path.model.peers.length} peers: max deviation ${roundSig(stats.maxDeviation)} sigma.`,
            chart: {
              ...chart,
              type: "line",
              series: [valueSeries, { key: "expected", label: "expected from peers", source: { derived: "expected" }, style: "dashed" }, ...peerSeries],
              secondary: [{ key: "deviation", label: "deviation (sigma)", source: { derived: "deviation" }, style: "solid" }],
            },
          },
          { expected, deviation },
        ),
      );
    } else {
      const ref = path.ref as DistanceReference;
      evidenceIds.push(
        sink.add(
          {
            kind: "distribution",
            sensors: [alias],
            window: full,
            method: "wasserstein-1",
            stats: { n: baseSorted.length, windowSize: w, stride, scale: ref.scale, center: ref.center, spread: ref.spread, ...commonStats },
            verdict: `${alias} ${every.length > 0 ? "tracks its peers, but its" : "has no peers. Its"} rolling distribution ${stayed ? "stays within" : "moves beyond"} ${roundSig(limit)} standardized units of the baseline: max ${roundSig(stats.maxDeviation)}.`,
            chart: {
              ...chart,
              type: "line",
              series: [valueSeries],
              histograms: [
                { label: "baseline", ...histogram(y.subarray(baseline.from, baseline.to), p1, p99) },
                { label: `last ${w} samples`, ...histogram(y.subarray(Math.max(0, n - w), n), p1, p99) },
              ],
              secondary: [{ key: "distance", label: "standardized distance", source: { derived: "distance" }, style: "solid" }],
            },
          },
          { distance: series },
        ),
      );
    }

    const baselineBlocks = blockMedians(series, path.blockSize, baseline.from, baseline.to);
    evidenceIds.push(
      sink.add({
        kind: "trend",
        sensors: [alias],
        window: after,
        method: "theil-sen",
        stats: {
          n: n - baseline.to,
          blocks: stats.medians.length,
          block: path.blockSize,
          slope: stats.slope,
          ratePer1000: stats.slope * 1000,
          mannKendallZ: stats.z,
          pValue: stats.p,
          maxDeviation: stats.maxDeviation,
        },
        verdict: `Block medians of ${alias} after sample ${baseline.to} trend at ${roundSig(stats.slope * 1000)} per 1000 samples, Mann-Kendall p ${roundSig(stats.p)}.`,
        chart: {
          type: "bar",
          window: full,
          series: [],
          bars: [
            ...baselineBlocks.centers.map((c, j) => ({ label: String(Math.round(c)), value: baselineBlocks.medians[j]! })),
            ...stats.centers.map((c, j) => ({ label: String(Math.round(c)), value: stats.medians[j]! })),
          ],
          marks: [{ at: baseline.to, label: "baseline end", kind: "boundary" }],
          threshold: limit,
        },
      }),
    );
    if (drifting && alarm) {
      evidenceIds.push(
        sink.add(
          {
            kind: "changepoint",
            sensors: [alias],
            window: after,
            method: "cusum",
            stats: {
              n: n - baseline.to,
              onset: alarm.onset,
              alarm: alarm.index,
              detectionDelay: alarm.index - alarm.onset,
              side: alarm.side,
              cusumK: thresholds.cusumK,
              cusumH: path.h,
            },
            verdict: `CUSUM of ${alias} crosses ${roundSig(path.h)} at sample ${alarm.index}. The onset is sample ${alarm.onset}.`,
            chart: {
              type: "line",
              window: after,
              series: [{ key: "cusum", label: "CUSUM", source: { derived: "cusum" }, style: "solid" }],
              marks: [
                { at: alarm.onset, label: `onset ${alarm.onset}`, kind: "onset" },
                { at: alarm.index, label: `alarm ${alarm.index}`, kind: "changepoint" },
              ],
              threshold: path.h,
            },
          },
          { cusum: alarm.side < 0 ? c.neg : c.pos },
        ),
      );
    }
    drafts.push({
      index: i,
      alias,
      peers: model?.peers ?? [],
      model,
      stats,
      alarm,
      inRange,
      evidenceIds,
      responsible: null,
      victimOf: null,
      drifting,
    });
  }

  for (const d of drafts) {
    if (!d.drifting) continue;
    const iso = isolationWindow(d);
    d.responsible = d.peers.every((p) => flatWithout(grid.aliases.indexOf(p.alias), d.alias, iso)) ? d.alias : null;
  }
  const drivers = drafts
    .filter((d) => d.drifting && d.responsible === d.alias && d.model)
    .sort((a, b) => b.stats.maxDeviation - a.stats.maxDeviation);
  for (const driver of drivers) {
    if (driver.victimOf) continue;
    for (const d of drafts) {
      if (d === driver || !d.drifting || d.victimOf || !d.peers.some((p) => p.alias === driver.alias)) continue;
      if (flatWithout(d.index, driver.alias, isolationWindow(d))) {
        d.victimOf = driver.alias;
        d.responsible = driver.alias;
      }
    }
  }
  const flatWith = (d: Draft, extra: string, iso: Window): boolean => {
    if (!d.model) return false;
    const peers = [...peersOf(d.alias), { alias: extra, lag: 0, rho: 0, n: 0 }];
    const refit = fitPeerModel(grid, d.index, peers, baseline, masks);
    const deviation = refit.predict(grid, masks).deviation.map((v) => (v * refit.sigma) / d.model!.sigma);
    const before = blockStats(d.model.deviation, iso.from, iso.to, block, fine).maxDeviation;
    return blockStats(deviation, iso.from, iso.to, block, fine).maxDeviation < Math.min(limit, 0.5 * before);
  };
  for (const driver of drivers) {
    if (driver.victimOf) continue;
    for (const d of drafts) {
      if (d === driver || !d.drifting || d.victimOf || !d.model || d.peers.some((p) => p.alias === driver.alias)) continue;
      if (flatWith(d, driver.alias, isolationWindow(d))) {
        d.victimOf = driver.alias;
        d.responsible = driver.alias;
      }
    }
  }

  return drafts.map((d): DriftResult => {
    const override = overrides.responsible?.[d.alias];
    if (d.drifting && override) {
      d.responsible = override;
      d.victimOf = override === d.alias ? null : override;
    }
    const onset = d.drifting && d.alarm ? d.alarm.onset : null;
    const detectionDelay = d.drifting && d.alarm ? d.alarm.index - d.alarm.onset : null;
    const value: DriftValue = {
      sensor: d.alias,
      method: d.model ? "peer-residual" : "distribution",
      peers: d.peers.map((p) => p.alias),
      onset,
      ratePer1000: d.stats.slope * 1000,
      mannKendallZ: d.stats.z,
      pValue: d.stats.p,
      severity: d.stats.maxDeviation / limit,
      maxDeviation: d.stats.maxDeviation,
      drifting: d.drifting,
      inRange: d.inRange,
      responsible: d.responsible,
      detectionDelay,
    };
    const subject = d.model
      ? `${d.alias} ${d.drifting ? "drifts from" : "tracks"} its ${d.peers.length} peers.`
      : `${d.alias} has no peers. Its rolling distribution ${d.drifting ? "moves away from" : "stays close to"} the baseline.`;
    const unit = d.model ? "sigma" : "standardized units";
    const parts = [subject, `Max deviation ${roundSig(d.stats.maxDeviation)} ${unit}, limit ${roundSig(limit)}.`];
    if (d.drifting) {
      if (onset !== null) parts.push(`Onset at sample ${onset}, detection delay ${detectionDelay} samples.`);
      parts.push(`Rate ${roundSig(value.ratePer1000)} ${unit} per 1000 samples, Mann-Kendall p ${roundSig(d.stats.p)}.`);
      parts.push(d.inRange ? "The value stays inside the baseline p1 to p99 range." : "The value has left the baseline p1 to p99 range.");
      if (override) parts.push(`The operator set the responsible sensor to ${override}.`);
      else if (d.victimOf) parts.push(`${d.alias} follows ${d.victimOf}: its deviation falls below the limit without ${d.victimOf}.`);
      else if (d.responsible === d.alias) parts.push(d.model ? `${d.alias} is responsible: its peers stay flat without it.` : `${d.alias} is responsible.`);
      else parts.push("The responsible sensor is not known.");
    }
    return {
      value,
      claim: parts.join(" "),
      confidence: Math.min(1, Math.max(0, d.stats.maxDeviation / limit - 1)),
      evidenceIds: d.evidenceIds,
      model: d.model,
      victimOf: d.victimOf,
      drifting: d.drifting,
    };
  });
}
