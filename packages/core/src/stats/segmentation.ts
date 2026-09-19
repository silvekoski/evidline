import type { Window } from "@tpm/schemas";
import { scaleSpans, spans } from "./episodes";
import { mad, median } from "./quantile";
import { bucketMeans, noiseLevel } from "./series";

export type SegmentationOptions = { maxPoints?: number; minSegment?: number; penalty?: number; episodes?: Window[] };

export function binarySegmentation(x: Float64Array, opts: SegmentationOptions = {}): number[] {
  const n = x.length;
  const bucket = Math.max(1, Math.ceil(n / (opts.maxPoints ?? 4096)));
  const ds = bucketMeans(x, bucket);
  const m = ds.length;
  const center = median(ds);
  const level = Float64Array.from(ds, (v) => v - center);
  let scale = Math.max(mad(x), noiseLevel(x, opts.episodes));
  if (scale === 0) {
    let sq = 0;
    let count = 0;
    for (const v of level) {
      if (Number.isFinite(v)) {
        sq += v * v;
        count++;
      }
    }
    scale = count > 0 ? Math.sqrt(sq / count) : 0;
  }
  if (scale === 0) return [];
  const minSeg = Math.max(2, Math.ceil((opts.minSegment ?? Math.max(2 * bucket, Math.floor(n / 100))) / bucket));
  const penalty = opts.penalty ?? 2 * Math.log(m);
  const cnt = new Float64Array(m + 1);
  const sum = new Float64Array(m + 1);
  const sq = new Float64Array(m + 1);
  for (let i = 0; i < m; i++) {
    const v = level[i]!;
    const ok = Number.isFinite(v);
    cnt[i + 1] = cnt[i]! + (ok ? 1 : 0);
    sum[i + 1] = sum[i]! + (ok ? v : 0);
    sq[i + 1] = sq[i]! + (ok ? v * v : 0);
  }
  const cost = (s: number, e: number) => {
    const c = cnt[e]! - cnt[s]!;
    if (c === 0) return 0;
    const su = sum[e]! - sum[s]!;
    return sq[e]! - sq[s]! - (su * su) / c;
  };
  const found: number[] = [];
  const stack = scaleSpans(spans(n, opts.episodes), bucket).map(({ from, to }): [number, number] => [from, to]);
  while (stack.length > 0) {
    const [s, e] = stack.pop()!;
    if (e - s < 2 * minSeg) continue;
    const whole = cost(s, e);
    let best = -1;
    let bestGain = 0;
    for (let c = s + minSeg; c <= e - minSeg; c++) {
      const gain = (whole - cost(s, c) - cost(c, e)) / (scale * scale);
      if (gain > bestGain) {
        bestGain = gain;
        best = c;
      }
    }
    if (best < 0 || bestGain <= penalty) continue;
    found.push(best);
    stack.push([s, best], [best, e]);
  }
  const tolerance = Math.max(2, Math.floor(0.001 * n));
  const boundaries = spans(n, opts.episodes).flatMap(({ from, to }) => [from, to]);
  return found
    .map((c) => c * bucket)
    .filter((c) => boundaries.every((b) => Math.abs(c - b) > tolerance))
    .sort((a, b) => a - b);
}
