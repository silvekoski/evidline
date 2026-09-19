import type { Window } from "@tpm/schemas";
import { spans } from "./episodes";
import { quantile } from "./quantile";

export type RunLengths = { starts: Int32Array; lengths: Int32Array; values: Float64Array };

export function runLengths(x: Float64Array, episodes?: Window[]): RunLengths {
  const starts: number[] = [];
  const lengths: number[] = [];
  const values: number[] = [];
  for (const { from, to } of spans(x.length, episodes)) {
    let i = from;
    while (i < to) {
      const v = x[i]!;
      if (!Number.isFinite(v)) {
        i++;
        continue;
      }
      let j = i + 1;
      while (j < to && x[j] === v) j++;
      starts.push(i);
      lengths.push(j - i);
      values.push(v);
      i = j;
    }
  }
  return { starts: Int32Array.from(starts), lengths: Int32Array.from(lengths), values: Float64Array.from(values) };
}

export function holdOf(x: Float64Array): number {
  const covered = new Map<number, number>();
  let total = 0;
  for (const len of runLengths(x).lengths) {
    covered.set(len, (covered.get(len) ?? 0) + len);
    total += len;
  }
  let hold = 1;
  let best = 0;
  for (const [len, samples] of covered) {
    if (samples > best) {
      best = samples;
      hold = len;
    }
  }
  return best > 0.8 * total ? hold : 1;
}

export function compressHold(x: Float64Array, hold: number): Float64Array {
  if (hold <= 1) return x.slice();
  const out = new Float64Array(Math.ceil(x.length / hold)).fill(NaN);
  for (let b = 0; b < out.length; b++) {
    for (let i = b * hold; i < Math.min(x.length, (b + 1) * hold); i++) {
      const v = x[i]!;
      if (Number.isFinite(v)) {
        out[b] = v;
        break;
      }
    }
  }
  return out;
}

export function longestRun(x: Float64Array, episodes?: Window[]): number {
  let best = 0;
  for (const len of runLengths(x, episodes).lengths) if (len > best) best = len;
  return best;
}

export function p99RunLength(x: Float64Array, episodes?: Window[]): number {
  return quantile(Float64Array.from(runLengths(x, episodes).lengths), 0.99);
}
