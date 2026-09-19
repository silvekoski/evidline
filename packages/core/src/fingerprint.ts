import type { Fingerprint, SignalType, Window } from "@tpm/schemas";
import { acfTime, dominantPeriod } from "./stats/autocorrelation";
import { histogram } from "./stats/distribution";
import { scaleSpans } from "./stats/episodes";
import { finiteSorted, mad, quantiles } from "./stats/quantile";
import { compressHold, holdOf, runLengths } from "./stats/runs";
import { diff, noiseLevel, stepSize } from "./stats/series";
import { window } from "./types";

export type SignalShape = Pick<Fingerprint, "distinct" | "flatShare" | "monotonicShare" | "acfTime">;

export function classifySignal(fp: SignalShape): SignalType {
  if (fp.distinct <= 1) return "constant";
  if (fp.distinct === 2) return "binary";
  if (fp.distinct <= 8 && fp.flatShare > 0.9) return "state";
  if (fp.monotonicShare > 0.98) return "counter";
  if (fp.flatShare > 0.6) return "step";
  return fp.acfTime > 20 ? "slow" : "fast";
}

export function fingerprint(x: Float64Array, episodes: Window[]): Fingerprint {
  const n = x.length;
  let missing = 0;
  for (const v of x) if (!Number.isFinite(v)) missing++;
  const sorted = finiteSorted(x);
  let distinct = sorted.length > 0 ? 1 : 0;
  for (let i = 1; i < sorted.length && distinct < 100000; i++) if (sorted[i] !== sorted[i - 1]) distinct++;

  const hold = holdOf(x);
  const y = hold > 1 ? compressHold(x, hold) : x;
  const spans = hold > 1 ? scaleSpans(episodes, hold).map((s) => window(s.from, s.to)) : episodes;
  let flat = 0;
  let covered = 0;
  for (const len of runLengths(y, spans).lengths) {
    covered += len;
    if (len >= 3) flat += len;
  }
  let signed = 0;
  let moves = 0;
  for (const d of diff(y, spans)) {
    if (Number.isFinite(d) && d !== 0) {
      signed += Math.sign(d);
      moves++;
    }
  }

  const q = quantiles(x);
  const shape = {
    n,
    missingRate: n > 0 ? missing / n : 0,
    quantiles: q,
    mad: mad(x),
    histogram: histogram(x, q.p1, q.p99),
    step: stepSize(y),
    hold,
    noise: noiseLevel(y, spans),
    acfTime: acfTime(x, episodes),
    period: dominantPeriod(x),
    flatShare: covered > 0 ? flat / covered : 0,
    monotonicShare: moves > 0 ? Math.abs(signed) / moves : 0,
    distinct,
  };
  return { ...shape, signalType: classifySignal(shape) };
}
