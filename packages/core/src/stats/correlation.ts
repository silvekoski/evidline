import type { Window } from "@tpm/schemas";
import { spans, type Span } from "./episodes";
import { centered } from "./series";

export function ranks(x: Float64Array): Float64Array {
  const idx: number[] = [];
  for (let i = 0; i < x.length; i++) if (Number.isFinite(x[i])) idx.push(i);
  idx.sort((a, b) => x[a]! - x[b]!);
  const out = new Float64Array(x.length).fill(NaN);
  for (let i = 0; i < idx.length; ) {
    const v = x[idx[i]!]!;
    let j = i + 1;
    while (j < idx.length && x[idx[j]!] === v) j++;
    const r = (i + j + 1) / 2;
    for (let k = i; k < j; k++) out[idx[k]!] = r;
    i = j;
  }
  return out;
}

function laggedPearson(a: Float64Array, b: Float64Array, lag: number, sp: Span[]): { rho: number; n: number } {
  let n = 0;
  let su = 0;
  let sv = 0;
  let suu = 0;
  let svv = 0;
  let suv = 0;
  for (const { from, to } of sp) {
    for (let t = from + Math.max(0, lag); t < to + Math.min(0, lag); t++) {
      const u = a[t - lag]!;
      const v = b[t]!;
      if (Number.isFinite(u) && Number.isFinite(v)) {
        n++;
        su += u;
        sv += v;
        suu += u * u;
        svv += v * v;
        suv += u * v;
      }
    }
  }
  if (n < 2) return { rho: 0, n };
  const d = Math.sqrt((n * suu - su * su) * (n * svv - sv * sv));
  return { rho: d > 0 ? Math.max(-1, Math.min(1, (n * suv - su * sv) / d)) : 0, n };
}

export function pearson(a: Float64Array, b: Float64Array): { rho: number; n: number } {
  return laggedPearson(centered(a), centered(b), 0, spans(Math.min(a.length, b.length)));
}

export function spearman(a: Float64Array, b: Float64Array): { rho: number; n: number } {
  return pearson(ranks(a), ranks(b));
}

export type CrossCorrelation = { lags: number[]; rhos: number[]; bestLag: number; bestRho: number; n: number };

export function crossCorrelation(a: Float64Array, b: Float64Array, maxLag: number, episodes?: Window[]): CrossCorrelation {
  const ca = centered(a);
  const cb = centered(b);
  const sp = spans(Math.min(a.length, b.length), episodes);
  const lags: number[] = [];
  const rhos: number[] = [];
  let best = { lag: 0, ...laggedPearson(ca, cb, 0, sp) };
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    const r = laggedPearson(ca, cb, lag, sp);
    lags.push(lag);
    rhos.push(r.rho);
    const gain = Math.abs(r.rho) - Math.abs(best.rho);
    if (gain > 1e-12 || (Math.abs(gain) <= 1e-12 && Math.abs(lag) < Math.abs(best.lag))) best = { lag, ...r };
  }
  return { lags, rhos, bestLag: best.lag, bestRho: best.rho, n: best.n };
}
