import type { Window } from "@tpm/schemas";
import { scaleSpans, spans, type Span } from "./episodes";
import { bucketMeans, centered } from "./series";

function sumSquares(c: Float64Array): number {
  let s = 0;
  for (const v of c) if (Number.isFinite(v)) s += v * v;
  return s;
}

function acfAt(c: Float64Array, denom: number, lag: number, sp: Span[]): number {
  let s = 0;
  for (const { from, to } of sp) {
    for (let t = from; t < to - lag; t++) {
      const u = c[t]!;
      const v = c[t + lag]!;
      if (Number.isFinite(u) && Number.isFinite(v)) s += u * v;
    }
  }
  return s / denom;
}

export function autocorrelation(x: Float64Array, maxLag: number, episodes?: Window[]): Float64Array {
  const out = new Float64Array(maxLag + 1);
  const c = centered(x);
  const denom = sumSquares(c);
  if (denom === 0) {
    out[0] = 1;
    return out;
  }
  const sp = spans(x.length, episodes);
  for (let lag = 0; lag <= maxLag; lag++) out[lag] = acfAt(c, denom, lag, sp);
  return out;
}

function reduced(x: Float64Array): { c: Float64Array; denom: number; bucket: number } {
  const bucket = Math.max(1, Math.ceil(x.length / 8192));
  const c = centered(bucketMeans(x, bucket));
  return { c, denom: sumSquares(c), bucket };
}

export function acfTime(x: Float64Array, episodes?: Window[]): number {
  const { c, denom, bucket } = reduced(x);
  if (denom === 0) return 0;
  const sp = scaleSpans(spans(x.length, episodes), bucket);
  const maxLag = Math.floor(c.length / 4);
  for (let lag = 1; lag <= maxLag; lag++) {
    if (acfAt(c, denom, lag, sp) < 1 / Math.E) return lag * bucket;
  }
  return maxLag * bucket;
}

export function dominantPeriod(x: Float64Array, minPeak = 0.2): number | null {
  const { c, denom, bucket } = reduced(x);
  if (denom === 0) return null;
  const maxLag = Math.floor(c.length / 4);
  const acf = autocorrelation(c, maxLag);
  let lag = 1;
  while (lag <= maxLag && acf[lag]! >= 0) lag++;
  let bestLag = 0;
  let best = minPeak;
  for (let k = lag + 1; k < maxLag; k++) {
    const v = acf[k]!;
    if (v > acf[k - 1]! && v >= acf[k + 1]! && v >= best) {
      best = v;
      bestLag = k;
    }
  }
  return bestLag > 0 ? bestLag * bucket : null;
}
