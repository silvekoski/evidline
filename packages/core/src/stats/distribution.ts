import { finiteSorted, quantileSorted } from "./quantile";

export function wasserstein1(a: Float64Array, b: Float64Array): number {
  const sa = finiteSorted(a);
  const sb = finiteSorted(b);
  if (sa.length === 0 || sb.length === 0) return 0;
  let total = 0;
  for (let i = 0; i < 200; i++) {
    const p = (i + 0.5) / 200;
    total += Math.abs(quantileSorted(sa, p) - quantileSorted(sb, p));
  }
  return total / 200;
}

export function histogram(x: Float64Array, p1: number, p99: number): { edges: number[]; shares: number[] } {
  const width = (p99 - p1) / 18;
  const edges = Array.from({ length: 21 }, (_, i) => p1 + (i - 1) * width);
  const counts = new Array<number>(20).fill(0);
  let total = 0;
  for (const v of x) {
    if (!Number.isFinite(v)) continue;
    const bin = v < p1 ? 0 : v > p99 ? 19 : width > 0 ? Math.min(19, 1 + Math.floor((v - p1) / width)) : 9;
    counts[bin] = counts[bin]! + 1;
    total++;
  }
  return { edges, shares: counts.map((c) => (total > 0 ? c / total : 0)) };
}
