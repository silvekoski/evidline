import { window } from "@tpm/core";
import type { Window } from "@tpm/schemas";

export function aliases(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `S${String(i + 1).padStart(2, "0")}`);
}

export type BuiltGrid = { values: Float64Array[]; n: number; time: Float64Array | null; bucket: number; rows: number; episodes: Window[] };

export class GridBuilder {
  private readonly sums: Float64Array[];
  private readonly counts: Uint32Array[];
  private readonly times: Float64Array;
  private readonly starts: number[] = [0];
  private bucket = 1;
  private rows = 0;

  constructor(
    columns: number,
    private readonly maxGrid: number,
  ) {
    this.sums = Array.from({ length: columns }, () => new Float64Array(maxGrid));
    this.counts = Array.from({ length: columns }, () => new Uint32Array(maxGrid));
    this.times = new Float64Array(maxGrid).fill(NaN);
  }

  startEpisode(): void {
    this.starts.push(this.rows);
  }

  push(values: Float64Array, time: number): void {
    if (this.rows === this.maxGrid * this.bucket) this.halve();
    const b = Math.floor(this.rows / this.bucket);
    if (Number.isNaN(this.times[b]) && !Number.isNaN(time)) this.times[b] = time;
    for (let j = 0; j < values.length; j++) {
      const v = values[j] ?? NaN;
      if (Number.isNaN(v)) continue;
      const sums = this.sums[j] as Float64Array;
      const counts = this.counts[j] as Uint32Array;
      sums[b] = (sums[b] ?? 0) + v;
      counts[b] = (counts[b] ?? 0) + 1;
    }
    this.rows++;
  }

  private halve(): void {
    const half = Math.ceil(this.maxGrid / 2);
    for (let i = 0; i < half; i++) {
      const lo = 2 * i;
      const hi = lo + 1 < this.maxGrid ? lo + 1 : lo;
      this.times[i] = Number.isNaN(this.times[lo]) ? (this.times[hi] ?? NaN) : (this.times[lo] ?? NaN);
      for (let j = 0; j < this.sums.length; j++) {
        const sums = this.sums[j] as Float64Array;
        const counts = this.counts[j] as Uint32Array;
        sums[i] = (sums[lo] ?? 0) + (hi === lo ? 0 : (sums[hi] ?? 0));
        counts[i] = (counts[lo] ?? 0) + (hi === lo ? 0 : (counts[hi] ?? 0));
      }
    }
    this.times.fill(NaN, half);
    for (const sums of this.sums) sums.fill(0, half);
    for (const counts of this.counts) counts.fill(0, half);
    this.bucket *= 2;
  }

  finish(hasTime: boolean): BuiltGrid {
    const n = Math.ceil(this.rows / this.bucket);
    const values = this.sums.map((sums, j) => {
      const counts = this.counts[j] as Uint32Array;
      const out = new Float64Array(n);
      for (let i = 0; i < n; i++) out[i] = (counts[i] ?? 0) > 0 ? (sums[i] ?? 0) / (counts[i] ?? 1) : NaN;
      return out;
    });
    const bucketStarts = [...new Set(this.starts.map((row) => Math.floor(row / this.bucket)))].sort((a, b) => a - b).filter((s) => s < n);
    const episodes = bucketStarts.map((from, i) => window(from, bucketStarts[i + 1] ?? n));
    return { values, n, time: hasTime ? this.times.slice(0, n) : null, bucket: this.bucket, rows: this.rows, episodes };
  }
}
