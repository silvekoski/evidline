import type { CalibrationValue, Fingerprint, HealthClass, Thresholds, Window } from "@tpm/schemas";
import {
  defaultThresholds,
  evaluateHealth,
  healthBlockSize,
  healthBlockStats,
  healthReference,
  type HealthBlockStats,
  type HealthReference,
} from "./health";
import { injectFault } from "./inject";
import { mulberry32, type Rng } from "./random";
import { roundSig } from "./stats/series";
import type { EvidenceSink, Grid } from "./types";

export type HealthCalibrationResult = {
  thresholds: Partial<Thresholds>;
  value: CalibrationValue;
  claim: string;
  confidence: number;
  evidenceIds: string[];
};

type Parameter = "deadRunFactor" | "stuckNoiseRatio" | "spikeSigma" | "noisyRatio";

const target = 0.01;
const sigmas = [4, 5, 6, 8];
const candidates: Record<Parameter, number[]> = {
  deadRunFactor: [3, 5, 10, 20],
  stuckNoiseRatio: [0.2, 0.1, 0.05],
  spikeSigma: sigmas,
  noisyRatio: [2, 3, 5],
};
const parameters = Object.keys(candidates) as Parameter[];
const checkOf: Record<Parameter, HealthClass> = { deadRunFactor: "dead", stuckNoiseRatio: "stuck", spikeSigma: "spikes", noisyRatio: "noisy" };

const faults: { fault: string; magnitude: number; apply: (x: Float64Array, rng: Rng) => Float64Array }[] = [
  { fault: "flatline", magnitude: 0, apply: (x, rng) => injectFault(x, { kind: "dead", from: 0, magnitude: 0 }, rng) },
  { fault: "spikes", magnitude: 6, apply: (x, rng) => injectFault(x, { kind: "spikes", from: 0, magnitude: 6 }, rng) },
  { fault: "noise", magnitude: 3, apply: (x, rng) => injectFault(x, { kind: "noise", from: 0, magnitude: 3 }, rng) },
  { fault: "dropout", magnitude: 0.2, apply: (x, rng) => injectFault(x, { kind: "dropout", from: 0, magnitude: 0.2 }, rng) },
  { fault: "gain", magnitude: 1.1, apply: (x) => Float64Array.from(x, (v) => 1.1 * v) },
  { fault: "resolution", magnitude: 4, apply: (x, rng) => injectFault(x, { kind: "resolution", from: 0, magnitude: 4 }, rng) },
];

type Pair = { ref: HealthReference; segment: Float64Array; clean: HealthBlockStats[] };

function blockStats(segment: Float64Array, ref: HealthReference, w: number): HealthBlockStats[] {
  const count = Math.max(1, Math.floor(segment.length / w));
  return Array.from({ length: count }, (_, b) => healthBlockStats(segment.subarray(b * w, b === count - 1 ? segment.length : (b + 1) * w), ref));
}

function falseAlarm(p: Pair, parameter: Parameter, value: number): boolean {
  const th = { ...defaultThresholds, [parameter]: value };
  return p.clean.some((b) => !evaluateHealth(b, p.ref, th, 1).find((c) => c.check === checkOf[parameter])!.pass);
}

export function calibrateHealth(grid: Grid, baseline: Window, fps: Fingerprint[], sink: EvidenceSink, seed: number): HealthCalibrationResult {
  const { n, episodes } = grid;
  const w = healthBlockSize(n);
  const segments = Math.min(20, Math.max(4, Math.floor(baseline.n / 500)));
  const edges = Array.from({ length: segments + 1 }, (_, s) => baseline.from + Math.floor((s * baseline.n) / segments));
  const rng = mulberry32(seed);
  const sensors: string[] = [];
  const pairs: Pair[] = [];

  grid.aliases.forEach((alias, i) => {
    const fp = fps[i]!;
    if (fp.signalType !== "slow" && fp.signalType !== "fast") return;
    const ref = healthReference(grid.values[i]!, baseline, episodes, fp.hold, sigmas, w);
    if (ref.constant) return;
    sensors.push(alias);
    for (let s = 0; s < segments; s++) {
      const segment = grid.values[i]!.slice(edges[s]!, edges[s + 1]!);
      pairs.push({ ref, segment, clean: blockStats(segment, ref, w) });
    }
  });

  const rates: Record<string, number> = {};
  const picked = {} as Record<Parameter, number>;
  for (const parameter of parameters) {
    const scored = candidates[parameter].map((value) => ({
      value,
      rate: pairs.length > 0 ? pairs.filter((p) => falseAlarm(p, parameter, value)).length / pairs.length : 0,
    }));
    const chosen = pairs.length === 0 ? { value: defaultThresholds[parameter], rate: 0 } : (scored.find((c) => c.rate <= target) ?? scored.at(-1)!);
    picked[parameter] = chosen.value;
    rates[parameter] = chosen.rate;
  }
  const thresholds: Thresholds = { ...defaultThresholds, ...picked };

  let anyAlarms = 0;
  const detected = faults.map(() => 0);
  const delays = faults.map(() => 0);
  for (const p of pairs) {
    if (p.clean.some((b) => evaluateHealth(b, p.ref, thresholds, 1).some((c) => !c.pass))) anyAlarms++;
    faults.forEach((f, k) => {
      const stats = blockStats(f.apply(p.segment, rng), p.ref, w);
      const first = stats.findIndex((b) => evaluateHealth(b, p.ref, thresholds, 1).some((c) => !c.pass));
      if (first < 0) return;
      detected[k]!++;
      delays[k]! += first === stats.length - 1 ? p.segment.length : (first + 1) * w;
    });
  }

  const table = faults.map((f, k) => ({
    fault: f.fault,
    magnitude: f.magnitude,
    rate: pairs.length > 0 ? detected[k]! / pairs.length : 0,
    detected: pairs.length > 0 && detected[k]! / pairs.length >= 0.5,
    delay: detected[k]! > 0 ? Math.round(delays[k]! / detected[k]!) : null,
  }));
  const falseAlarmRate = Math.max(...parameters.map((p) => rates[p]!));
  const stats: Record<string, number> = {
    n: baseline.n,
    segments,
    sensors: sensors.length,
    pairs: pairs.length,
    blockSize: w,
    ...picked,
    falseAlarmRate,
    anyCheckRate: pairs.length > 0 ? anyAlarms / pairs.length : 0,
    targetFalseAlarmRate: target,
  };
  for (const p of parameters) stats[`${p}Rate`] = rates[p]!;
  for (const r of table) stats[`${r.fault}Detected`] = r.rate;

  const settings = parameters.map((p) => `${p} ${picked[p]}`).join(", ");
  const evidenceId = sink.add({
    kind: "calibration",
    sensors,
    window: baseline,
    method: "segment-injection",
    stats,
    verdict: `${settings}: false alarm rate ${roundSig(falseAlarmRate)} on ${segments} baseline segments of ${sensors.length} sensors, target ${target}.`,
    chart: {
      type: "bar",
      window: baseline,
      series: [],
      bars: table.map((r) => ({ label: `${r.fault} ${r.fault === "gain" || r.fault === "resolution" ? "x" : ""}${r.magnitude}`, value: r.rate })),
      threshold: 0.5,
    },
  });
  const found = table.filter((r) => r.detected).map((r) => r.fault);
  const missed = table.filter((r) => !r.detected).map((r) => r.fault);
  const summary =
    pairs.length === 0
      ? "No continuous sensor has a usable baseline, so the thresholds stay at their defaults."
      : `Detected: ${found.length > 0 ? found.join(", ") : "none"}. Not detected: ${missed.length > 0 ? missed.join(", ") : "none"}.`;
  return {
    thresholds: picked,
    value: {
      thresholds,
      falseAlarmRate,
      targetFalseAlarmRate: target,
      detection: table.map(({ fault, magnitude, detected, delay }) => ({ fault, magnitude, detected, delay })),
    },
    claim: `Health calibration on ${segments} baseline segments of ${sensors.length} sensors: ${settings}. False alarm rate ${roundSig(falseAlarmRate)}, target ${target}. ${summary}`,
    confidence: 1,
    evidenceIds: [evidenceId],
  };
}
