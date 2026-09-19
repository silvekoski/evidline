import type { Window } from "@tpm/schemas";

export type CusumAlarm = { index: number; side: 1 | -1; onset: number };

export type CusumResult = { pos: Float64Array; neg: Float64Array; alarms: CusumAlarm[] };

export function cusum(x: Float64Array, k: number, h: number, opts: { start: number; episodes: Window[] }): CusumResult {
  const pos = new Float64Array(x.length);
  const neg = new Float64Array(x.length);
  const alarms: CusumAlarm[] = [];
  for (const { from, to } of opts.episodes) {
    const begin = Math.max(from, opts.start);
    let p = 0;
    let q = 0;
    let zeroP = begin;
    let zeroQ = begin;
    for (let t = begin; t < to; t++) {
      const v = x[t]!;
      if (Number.isFinite(v)) {
        const np = Math.max(0, p + v - k);
        const nq = Math.max(0, q - v - k);
        if (np > h && p <= h) alarms.push({ index: t, side: 1, onset: zeroP });
        if (nq > h && q <= h) alarms.push({ index: t, side: -1, onset: zeroQ });
        p = np;
        q = nq;
      }
      if (p === 0) zeroP = t;
      if (q === 0) zeroQ = t;
      pos[t] = p;
      neg[t] = q;
    }
  }
  return { pos, neg, alarms };
}
