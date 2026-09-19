import type { Window } from "@tpm/schemas";
import { spans } from "./episodes";

const ascending = (a: number, b: number) => a - b;

function sortedMedian(w: number[]): number {
  const m = w.length >> 1;
  return w.length % 2 === 1 ? w[m]! : (w[m - 1]! + w[m]!) / 2;
}

function fillWindow(x: Float64Array, i: number, half: number, from: number, to: number, w: number[]): void {
  w.length = 0;
  for (let j = Math.max(from, i - half); j < Math.min(to, i + half + 1); j++) {
    const u = x[j]!;
    if (Number.isFinite(u)) w.push(u);
  }
  w.sort(ascending);
}

export function rollingMedian(x: Float64Array, window = 7, episodes?: Window[]): Float64Array {
  const out = new Float64Array(x.length).fill(NaN);
  const half = Math.floor(window / 2);
  const w: number[] = [];
  for (const { from, to } of spans(x.length, episodes)) {
    for (let i = from; i < to; i++) {
      fillWindow(x, i, half, from, to, w);
      if (w.length > 0) out[i] = sortedMedian(w);
    }
  }
  return out;
}

export function hampel(x: Float64Array, window = 7, k: number, episodes?: Window[]): Uint8Array {
  const flags = new Uint8Array(x.length);
  const half = Math.floor(window / 2);
  const w: number[] = [];
  const d: number[] = [];
  for (const { from, to } of spans(x.length, episodes)) {
    for (let i = from; i < to; i++) {
      const v = x[i]!;
      if (!Number.isFinite(v)) continue;
      fillWindow(x, i, half, from, to, w);
      if (w.length < 3) continue;
      const m = sortedMedian(w);
      d.length = 0;
      for (const u of w) d.push(Math.abs(u - m));
      d.sort(ascending);
      if (Math.abs(v - m) > k * 1.4826 * sortedMedian(d)) flags[i] = 1;
    }
  }
  return flags;
}
