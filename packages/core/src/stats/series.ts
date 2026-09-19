import type { Window } from "@tpm/schemas";
import { spans } from "./episodes";
import { finiteSorted, mad, quantileSorted } from "./quantile";

export function bucketMeans(x: Float64Array, bucket: number): Float64Array {
  if (bucket <= 1) return x.slice();
  const out = new Float64Array(Math.ceil(x.length / bucket)).fill(NaN);
  for (let b = 0; b < out.length; b++) {
    let sum = 0;
    let count = 0;
    for (let i = b * bucket; i < Math.min(x.length, (b + 1) * bucket); i++) {
      const v = x[i]!;
      if (Number.isFinite(v)) {
        sum += v;
        count++;
      }
    }
    if (count > 0) out[b] = sum / count;
  }
  return out;
}

export function downsample(x: Float64Array, target: number): Float64Array {
  return bucketMeans(x, Math.max(1, Math.ceil(x.length / target)));
}

export function centered(x: Float64Array): Float64Array {
  let sum = 0;
  let count = 0;
  for (const v of x) {
    if (Number.isFinite(v)) {
      sum += v;
      count++;
    }
  }
  const mean = count > 0 ? sum / count : 0;
  return Float64Array.from(x, (v) => v - mean);
}

export function blockMedians(
  x: Float64Array,
  block: number,
  from: number,
  to: number,
): { centers: number[]; medians: number[] } {
  const centers: number[] = [];
  const medians: number[] = [];
  if (to <= from) return { centers, medians };
  const size = Math.max(1, Math.floor(block));
  const count = Math.max(1, Math.floor((to - from) / size));
  for (let b = 0; b < count; b++) {
    const start = from + b * size;
    const end = b === count - 1 ? to : start + size;
    const sorted = finiteSorted(x.subarray(start, end));
    if (sorted.length === 0) continue;
    centers.push((start + end) / 2);
    medians.push(quantileSorted(sorted, 0.5));
  }
  return { centers, medians };
}

export function roundSig(x: number, digits = 3): number {
  return x === 0 || !Number.isFinite(x) ? x : Number(x.toPrecision(digits));
}

export function diff(x: Float64Array, episodes?: Window[]): Float64Array {
  const out = new Float64Array(x.length).fill(NaN);
  for (const { from, to } of spans(x.length, episodes)) {
    for (let t = from + 1; t < to; t++) out[t] = x[t]! - x[t - 1]!;
  }
  return out;
}

export function noiseLevel(x: Float64Array, episodes?: Window[]): number {
  return mad(diff(x, episodes)) / Math.SQRT2;
}

export function stepSize(x: Float64Array): number {
  const s = finiteSorted(x);
  let step = Infinity;
  let distinct = 1;
  for (let i = 1; i < s.length && distinct < 100000; i++) {
    const v = s[i]!;
    const d = v - s[i - 1]!;
    if (d > 1e-9 * Math.abs(v)) {
      distinct++;
      if (d < step) step = d;
    }
  }
  return Number.isFinite(step) ? step : 0;
}
