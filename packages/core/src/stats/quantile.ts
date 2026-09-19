import type { Quantiles } from "@tpm/schemas";

function finiteCopy(x: Float64Array): Float64Array {
  const out = new Float64Array(x.length);
  let count = 0;
  for (const v of x) if (Number.isFinite(v)) out[count++] = v;
  return out.subarray(0, count);
}

export function finiteSorted(x: Float64Array): Float64Array {
  return finiteCopy(x).sort();
}

function select(a: Float64Array, k: number): number {
  let lo = 0;
  let hi = a.length - 1;
  while (lo < hi) {
    const pivot = a[(lo + hi) >> 1]!;
    let i = lo;
    let j = hi;
    while (i <= j) {
      while (a[i]! < pivot) i++;
      while (a[j]! > pivot) j--;
      if (i <= j) {
        const t = a[i]!;
        a[i] = a[j]!;
        a[j] = t;
        i++;
        j--;
      }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else break;
  }
  return a[k]!;
}

function position(n: number, p: number): number {
  return Math.min(Math.max(p, 0), 1) * (n - 1);
}

export function quantileSorted(sorted: Float64Array, p: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const pos = position(n, p);
  const lo = Math.floor(pos);
  const a = sorted[lo]!;
  const b = sorted[Math.min(lo + 1, n - 1)]!;
  return a + (b - a) * (pos - lo);
}

export function quantile(x: Float64Array, p: number): number {
  const a = finiteCopy(x);
  const n = a.length;
  if (n === 0) return 0;
  const pos = position(n, p);
  const lo = Math.floor(pos);
  const first = select(a, lo);
  let next = first;
  if (pos > lo) {
    next = Infinity;
    for (let i = lo + 1; i < n; i++) if (a[i]! < next) next = a[i]!;
  }
  return first + (next - first) * (pos - lo);
}

export function median(x: Float64Array): number {
  return quantile(x, 0.5);
}

export function quantiles(x: Float64Array): Quantiles {
  const s = finiteSorted(x);
  return {
    p1: quantileSorted(s, 0.01),
    p5: quantileSorted(s, 0.05),
    p25: quantileSorted(s, 0.25),
    p50: quantileSorted(s, 0.5),
    p75: quantileSorted(s, 0.75),
    p95: quantileSorted(s, 0.95),
    p99: quantileSorted(s, 0.99),
  };
}

export function mad(x: Float64Array, center = median(x)): number {
  const dev = new Float64Array(x.length);
  let count = 0;
  for (const v of x) if (Number.isFinite(v)) dev[count++] = Math.abs(v - center);
  return 1.4826 * quantile(dev.subarray(0, count), 0.5);
}
