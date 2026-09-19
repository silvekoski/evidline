import type { CalibrationValue, Fingerprint, Thresholds, Window } from "@tpm/schemas";
import {
  blockStats,
  clipEpisodes,
  defaultDriftThresholds,
  detectionIndex,
  distanceReference,
  distanceWindow,
  driftBlock,
  fineBlock,
  isContinuous,
  isDrifting,
  rollingDistance,
} from "./drift";
import { injectFault, type FaultSpec } from "./inject";
import { alignPeers, fitColumns, maskedValues, predictRange } from "./peer-model";
import { mulberry32 } from "./random";
import type { Peer, RelationGraph } from "./relations";
import { cusum, roundSig } from "./stats";
import { window, type EvidenceSink, type Grid, type Masks } from "./types";

export type CalibrationResult = {
  thresholds: Partial<Thresholds>;
  value: CalibrationValue;
  claim: string;
  confidence: number;
  evidenceIds: string[];
};

const hGrid = [5, 10, 20, 50, 100, 200];
const kGrid = [0.5, 1];
const combos = kGrid.flatMap((k) => hGrid.map((h) => ({ k, h })));
const faults: { fault: string; kind: FaultSpec["kind"]; magnitude: number }[] = [
  ...[0.5, 1, 2, 4, 8].map((magnitude) => ({ fault: "bias", kind: "bias" as const, magnitude })),
  { fault: "gain", kind: "gain", magnitude: 1.1 },
];
const target = 0.01;
const maxFitRows = 16_384;

const baseThresholds: Thresholds = {
  ...defaultDriftThresholds,
  deadRunFactor: 5,
  stuckNoiseRatio: 0.1,
  spikeSigma: 5,
  noisyRatio: 3,
  dropoutRateFactor: 5,
  saturationShare: 0.05,
  redundancyRho: 0.95,
  relationRho: 0.3,
};

type Tally = { pairs: number; falseAlarms: number[]; detected: number[][]; delays: number[][] };

function tally(): Tally {
  return {
    pairs: 0,
    falseAlarms: combos.map(() => 0),
    detected: combos.map(() => faults.map(() => 0)),
    delays: combos.map(() => faults.map(() => 0)),
  };
}

function score(t: Tally, series: Float64Array, episodes: Window[], block: number, fine: number, limit: number, fault: number | null): void {
  const stats = blockStats(series, 0, series.length, block, fine);
  combos.forEach(({ k, h }, c) => {
    const alarm = cusum(series, k, h, { start: 0, episodes }).alarms[0] ?? null;
    const fired = isDrifting(stats, alarm, limit);
    if (fault === null) {
      if (fired || alarm) t.falseAlarms[c]!++;
      return;
    }
    if (!fired) return;
    t.detected[c]![fault]!++;
    t.delays[c]![fault]! += detectionIndex(stats, alarm, limit) ?? series.length;
  });
}

type Choice = { k: number; h: number; index: number; rate: number };

function pick(t: Tally, k: number | null): Choice {
  const rates = combos.map((c, index): Choice => ({ ...c, index, rate: t.pairs > 0 ? t.falseAlarms[index]! / t.pairs : 0 }));
  const smallestH = (own: Choice[]) => own.find((c) => c.rate <= target) ?? own[own.length - 1]!;
  const detected = (c: Choice) => t.detected[c.index]!.reduce((a, b) => a + b, 0);
  const delay = (c: Choice) => t.delays[c.index]!.reduce((a, b) => a + b, 0);
  return (k === null ? kGrid : [k])
    .map((kk) => smallestH(rates.filter((c) => c.k === kk).sort((a, b) => a.h - b.h)))
    .sort(
      (a, b) =>
        Number(a.rate > target) - Number(b.rate > target) || detected(b) - detected(a) || delay(a) - delay(b) || a.h - b.h || a.k - b.k,
    )[0]!;
}

export function calibrateDrift(
  grid: Grid,
  masks: Masks,
  graph: RelationGraph,
  baseline: Window,
  fps: Fingerprint[],
  sink: EvidenceSink,
  seed: number,
): CalibrationResult {
  const { n } = grid;
  const limit = defaultDriftThresholds.deviationLimit;
  const block = driftBlock(grid);
  const fine = fineBlock(n);
  const { w, stride } = distanceWindow(n);
  const length = baseline.to - baseline.from;
  const segments = Math.min(20, Math.max(2, Math.floor(length / Math.max(500, 2 * w))));
  const edges = Array.from({ length: segments + 1 }, (_, s) => baseline.from + Math.floor((s * length) / segments));
  const rng = mulberry32(seed);
  const peerTally = tally();
  const distanceTally = tally();
  const sensors: string[] = [];

  for (let i = 0; i < grid.aliases.length; i++) {
    const alias = grid.aliases[i]!;
    const fp = fps[i]!;
    if (!isContinuous(fp)) continue;
    const y = maskedValues(grid, masks, i);
    let valid = 0;
    for (let t = baseline.from; t < baseline.to; t++) if (Number.isFinite(y[t])) valid++;
    if (valid < 100) continue;
    sensors.push(alias);
    const peers: Peer[] = (graph.peers.get(alias) ?? []).filter((p) => p.alias !== alias && grid.aliases.includes(p.alias));
    const columns = peers.length > 0 ? alignPeers(grid, masks, peers) : null;
    const fitY = columns ? new Float64Array(n) : null;
    const thin = Math.max(1, Math.ceil(length / maxFitRows));
    const refStride = Math.max(stride, Math.floor(length / 80));

    for (let s = 0; s < segments; s++) {
      const from = edges[s]!;
      const to = edges[s + 1]!;
      const held = y.subarray(from, to);
      const episodes = clipEpisodes(grid.episodes, from, to);
      const others = [window(baseline.from, from), window(to, baseline.to)].filter((p) => p.n > 0);
      const inject = (f: (typeof faults)[number], sigma: number): Float64Array =>
        injectFault(held, { kind: f.kind, from: 0, magnitude: f.kind === "bias" ? f.magnitude * sigma : f.magnitude }, rng);

      if (columns && fitY) {
        fitY.fill(NaN);
        for (const part of others) for (let t = part.from; t < part.to; t += thin) fitY[t] = y[t]!;
        const fit = fitColumns(fitY, columns, fp.step);
        if (fit.n >= 100) {
          const clean = predictRange(fit, y, columns, from, to).deviation;
          peerTally.pairs++;
          score(peerTally, clean, episodes, block, fine, limit, null);
          faults.forEach((f, index) => {
            const injected = inject(f, fit.sigma);
            const series = Float64Array.from(clean, (d, t) => d + (injected[t]! - held[t]!) / fit.sigma);
            score(peerTally, series, episodes, block, fine, limit, index);
          });
        }
      }

      const ref = distanceReference(y, others, w, refStride, fp.step, thin);
      distanceTally.pairs++;
      score(distanceTally, rollingDistance(held, ref), episodes, Math.max(block, w), Math.max(block, w), limit, null);
      faults.forEach((f, index) =>
        score(distanceTally, rollingDistance(inject(f, ref.scale), ref), episodes, Math.max(block, w), Math.max(block, w), limit, index),
      );
    }
  }

  const peer = pick(peerTally, null);
  const distance = pick(distanceTally, peer.k);
  const chosen = { cusumH: peer.h, cusumK: peer.k, distributionLimit: distance.h, deviationLimit: limit };
  const rows = (t: Tally, path: string, choice: Choice) =>
    t.pairs === 0
      ? []
      : faults.map((f, index) => {
          const detected = t.detected[choice.index]![index]!;
          const rate = detected / t.pairs;
          return {
            fault: `${path} ${f.fault}`,
            magnitude: f.magnitude,
            detected: rate >= 0.5,
            delay: rate >= 0.5 ? Math.round(t.delays[choice.index]![index]! / detected) : null,
            rate,
            label: `${path} ${f.fault} ${f.kind === "bias" ? `${f.magnitude} sigma` : `x${f.magnitude}`}`,
          };
        });
  const table = [...rows(peerTally, "peer", peer), ...rows(distanceTally, "distance", distance)];
  const falseAlarmRate = Math.max(peerTally.pairs > 0 ? peer.rate : 0, distanceTally.pairs > 0 ? distance.rate : 0);
  const evidenceId = sink.add({
    kind: "calibration",
    sensors,
    window: baseline,
    method: "held-out-injection",
    stats: {
      n: length,
      segments,
      sensors: sensors.length,
      peerPairs: peerTally.pairs,
      distancePairs: distanceTally.pairs,
      cusumH: chosen.cusumH,
      cusumK: chosen.cusumK,
      distributionLimit: chosen.distributionLimit,
      deviationLimit: limit,
      falseAlarmRate,
      peerFalseAlarmRate: peer.rate,
      distanceFalseAlarmRate: distance.rate,
      targetFalseAlarmRate: target,
      windowSize: w,
      stride,
      block,
    },
    verdict: `cusumH ${chosen.cusumH}, cusumK ${chosen.cusumK}, distributionLimit ${chosen.distributionLimit}: false alarm rate ${roundSig(falseAlarmRate)} on ${segments} held-out segments, target ${target}.`,
    chart: {
      type: "bar",
      window: baseline,
      series: [],
      bars: table.map((r) => ({ label: r.label, value: r.rate })),
      threshold: 0.5,
    },
  });
  const firstBias = table.find((r) => r.fault === "peer bias" && r.detected) ?? table.find((r) => r.fault === "distance bias" && r.detected);
  const detection = firstBias
    ? `The smallest detected bias ramp reaches ${firstBias.magnitude} sigma, found after ${firstBias.delay} samples.`
    : "No injected bias ramp is detected.";
  return {
    thresholds: chosen,
    value: {
      thresholds: { ...baseThresholds, ...chosen },
      falseAlarmRate,
      targetFalseAlarmRate: target,
      detection: table.map(({ fault, magnitude, detected, delay }) => ({ fault, magnitude, detected, delay })),
    },
    claim: `Drift calibration on ${segments} held-out segments of ${sensors.length} sensors: cusumH ${chosen.cusumH}, cusumK ${chosen.cusumK}, distributionLimit ${chosen.distributionLimit}. False alarm rate ${roundSig(falseAlarmRate)}, target ${target}. ${detection}`,
    confidence: 1,
    evidenceIds: [evidenceId],
  };
}
