import { streamRows } from "./csv";
import { GridBuilder, aliases } from "./grid-builder";
import { parseNumber } from "./parse-number";
import { parseTime } from "./parse-time";
import { maxLevels, median, shape } from "./profile";
import type { LoadContext, Source } from "./types";

const weekMs = 7 * 86_400_000;
const bucketChoices = [1, 5, 15, 60, 120, 240, 360, 720, 1440].map((minutes) => minutes * 60_000).concat(weekMs);
const minRowsPerBucket = 100;
const maxSensors = 200;
const otherLevel = maxLevels;

type FieldKind = "number" | "category" | "id" | "text" | "empty";
type Field = { index: number; at: number; slot: number; name: string; kind: FieldKind; pattern: string; levels: Map<string, number>; splittable: boolean };
type Metric = { name: string; value: (bucket: Bucket) => number };

class Bucket {
  rows = 0;
  readonly nulls: number[];
  readonly violations: number[];
  readonly whole: number[];
  readonly zeroDigit: number[];
  readonly numbers: number[][];
  readonly levels: number[][];
  readonly ids: Set<string>[];
  private readonly sortedAll: (Float64Array | undefined)[];
  private readonly counted: (Int32Array | undefined)[];

  constructor(fields: number, numbers: number, categories: number, ids: number) {
    this.nulls = new Array<number>(fields).fill(0);
    this.violations = new Array<number>(fields).fill(0);
    this.whole = new Array<number>(numbers).fill(0);
    this.zeroDigit = new Array<number>(numbers).fill(0);
    this.numbers = Array.from({ length: numbers }, () => []);
    this.levels = Array.from({ length: categories }, () => []);
    this.ids = Array.from({ length: ids }, () => new Set());
    this.sortedAll = new Array<Float64Array | undefined>(numbers).fill(undefined);
    this.counted = new Array<Int32Array | undefined>(categories).fill(undefined);
  }

  filled(at: number): number {
    return this.rows - (this.nulls[at] ?? 0);
  }

  sorted(slot: number, categorySlot = -1, level = -1): Float64Array {
    const cached = categorySlot < 0 ? this.sortedAll[slot] : undefined;
    if (cached !== undefined) return cached;
    const levels = categorySlot < 0 ? null : (this.levels[categorySlot] ?? []);
    const picked = (this.numbers[slot] ?? []).filter((v, r) => Number.isFinite(v) && (levels === null || levels[r] === level));
    const sorted = Float64Array.from(picked).sort();
    if (categorySlot < 0) this.sortedAll[slot] = sorted;
    return sorted;
  }

  levelCounts(slot: number): Int32Array {
    const cached = this.counted[slot];
    if (cached !== undefined) return cached;
    const counts = new Int32Array(maxLevels + 1);
    for (const level of this.levels[slot] ?? []) if (level >= 0) counts[level] = (counts[level] ?? 0) + 1;
    this.counted[slot] = counts;
    return counts;
  }
}

function quantile(sorted: Float64Array, q: number): number {
  if (sorted.length === 0) return NaN;
  const position = q * (sorted.length - 1);
  const lo = Math.floor(position);
  const below = sorted[lo] ?? NaN;
  return below + ((sorted[Math.ceil(position)] ?? NaN) - below) * (position - lo);
}

function relativeVariance(series: Float64Array): number {
  const finite = series.filter((v) => !Number.isNaN(v));
  if (finite.length < 2) return -1;
  const mean = finite.reduce((a, b) => a + b, 0) / finite.length;
  const variance = finite.reduce((a, v) => a + (v - mean) * (v - mean), 0) / finite.length;
  return variance / Math.max(mean * mean, 1e-12);
}

function medianRowsPerBucket(times: number[], bucketMs: number): number {
  const counts = new Map<number, number>();
  for (const t of times) {
    const index = Math.floor(t / bucketMs);
    counts.set(index, (counts.get(index) ?? 0) + 1);
  }
  const ordered = [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([, count]) => count);
  return median(ordered.length > 2 ? ordered.slice(1, -1) : ordered);
}

function derivedNumberFields(fields: Field[], sample: string[][]): Map<string, string> {
  const numbers = fields.filter((f) => f.kind === "number");
  const columns = numbers.map((f) => sample.map((row) => parseNumber((row[f.index] ?? "").trim())));
  const rowsOk = (test: (r: number) => boolean) => {
    let seen = 0;
    for (let r = 0; r < sample.length; r++) {
      const values = columns.map((c) => c[r] as number);
      if (values.some((v) => !Number.isFinite(v))) continue;
      seen++;
      if (!test(r)) return false;
    }
    return seen >= 50;
  };
  const close = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
  const found = new Map<string, string>();
  for (let z = 0; z < numbers.length; z++) {
    const cz = columns[z]!;
    for (let x = 0; x < numbers.length && !found.has(numbers[z]!.name); x++) {
      if (x === z || found.has(numbers[x]!.name)) continue;
      const cx = columns[x]!;
      const first = sample.findIndex((_, r) => Number.isFinite(cx[r]) && Number.isFinite(cz[r]) && cx[r] !== 0);
      const k = first >= 0 ? (cz[first] as number) / (cx[first] as number) : NaN;
      if (Number.isFinite(k) && k !== 1 && rowsOk((r) => close(cz[r] as number, k * (cx[r] as number)))) {
        found.set(numbers[z]!.name, `${numbers[z]!.name} = ${Number(k.toPrecision(6))} x ${numbers[x]!.name}`);
        continue;
      }
      for (let y = x + 1; y < numbers.length; y++) {
        if (y === z || found.has(numbers[y]!.name)) continue;
        const cy = columns[y]!;
        if (rowsOk((r) => close(cz[r] as number, (cx[r] as number) + (cy[r] as number)))) {
          found.set(numbers[z]!.name, `${numbers[z]!.name} = ${numbers[x]!.name} + ${numbers[y]!.name}`);
          break;
        }
        if (rowsOk((r) => close(cz[r] as number, (cx[r] as number) - (cy[r] as number)))) {
          found.set(numbers[z]!.name, `${numbers[z]!.name} = ${numbers[x]!.name} - ${numbers[y]!.name}`);
          break;
        }
      }
    }
  }
  return found;
}

function defineMetrics(fields: Field[]): Metric[] {
  const metrics: Metric[] = [{ name: "rows.count", value: (b) => b.rows }];
  for (const f of fields) {
    metrics.push({ name: `${f.name}.nullRate`, value: (b) => (b.nulls[f.at] ?? 0) / b.rows });
    if (f.kind === "empty") continue;
    metrics.push({ name: `${f.name}.formatViolationRate`, value: (b) => (b.violations[f.at] ?? 0) / b.filled(f.at) });
    if (f.kind === "number") {
      metrics.push(
        { name: `${f.name}.median`, value: (b) => quantile(b.sorted(f.slot), 0.5) },
        { name: `${f.name}.p95`, value: (b) => quantile(b.sorted(f.slot), 0.95) },
        { name: `${f.name}.roundShare`, value: (b) => (b.whole[f.slot] ?? 0) / b.sorted(f.slot).length },
        { name: `${f.name}.zeroDigitShare`, value: (b) => (b.zeroDigit[f.slot] ?? 0) / b.filled(f.at) },
      );
    } else if (f.kind === "category") {
      for (const [value, level] of f.levels) {
        metrics.push({ name: `${f.name}.share[${value}]`, value: (b) => (b.levelCounts(f.slot)[level] ?? 0) / b.filled(f.at) });
      }
      metrics.push({ name: `${f.name}.otherShare`, value: (b) => (b.levelCounts(f.slot)[otherLevel] ?? 0) / b.filled(f.at) });
    } else if (f.kind === "id") {
      metrics.push(
        { name: `${f.name}.distinct`, value: (b) => (b.ids[f.slot]?.size ?? 0) },
        { name: `${f.name}.duplicateRate`, value: (b) => 1 - (b.ids[f.slot]?.size ?? 0) / b.filled(f.at) },
      );
    }
  }
  const numbers = fields.filter((f) => f.kind === "number");
  for (const c of fields.filter((f) => f.splittable)) {
    for (const [value, level] of c.levels) {
      const split = `[${c.name}=${value}]`;
      metrics.push({ name: `rows.count${split}`, value: (b) => b.levelCounts(c.slot)[level] ?? 0 });
      for (const f of numbers) {
        metrics.push({ name: `${f.name}.median${split}`, value: (b) => quantile(b.sorted(f.slot, c.slot, level), 0.5) });
      }
    }
  }
  return metrics;
}

export async function loadRecords(ctx: LoadContext): Promise<Source> {
  const { header, profiles, sample, delimiter } = ctx;
  const timeColumn = ctx.layout.timeColumn ?? -1;
  const timeUnit = profiles[timeColumn]?.timeUnit ?? "iso";
  const sampleTimes = sample.map((row) => parseTime(row[timeColumn] ?? "", timeUnit)).filter(Number.isFinite);
  const bucketMs = bucketChoices.find((ms) => medianRowsPerBucket(sampleTimes, ms) >= minRowsPerBucket) ?? weekMs;

  const slots = { number: 0, category: 0, id: 0, text: -1, empty: -1 };
  const fields: Field[] = [];
  profiles.forEach((p, index) => {
    if (index === timeColumn) return;
    const kind: FieldKind = p.kind === "counter" ? "id" : p.kind === "timestamp" ? "text" : p.kind;
    const slot = kind === "text" || kind === "empty" ? -1 : slots[kind]++;
    const levels = new Map(p.levels.map((value, level) => [value, level]));
    fields.push({ index, at: fields.length, slot, name: p.name, kind, pattern: p.pattern, levels, splittable: kind === "category" && p.distinct <= maxLevels });
  });
  const derived = derivedNumberFields(fields, sample);
  for (const f of fields) if (derived.has(f.name)) f.kind = "text";
  const newBucket = (): Bucket => new Bucket(fields.length, slots.number, slots.category, slots.id);

  const buckets = new Map<number, Bucket>();
  const rows = await streamRows(
    ctx.path,
    { delimiter, fast: false },
    (cells) => {
      const t = parseTime(cells[timeColumn] ?? "", timeUnit);
      if (Number.isNaN(t)) return;
      const index = Math.floor(t / bucketMs);
      let bucket = buckets.get(index);
      if (bucket === undefined) {
        bucket = newBucket();
        buckets.set(index, bucket);
      }
      bucket.rows++;
      for (const f of fields) {
        const cell = (cells[f.index] ?? "").trim();
        if (cell === "") {
          bucket.nulls[f.at] = (bucket.nulls[f.at] ?? 0) + 1;
          if (f.kind === "number") bucket.numbers[f.slot]?.push(NaN);
          else if (f.kind === "category") bucket.levels[f.slot]?.push(-1);
          continue;
        }
        if (f.kind === "empty") continue;
        if (shape(cell) !== f.pattern) bucket.violations[f.at] = (bucket.violations[f.at] ?? 0) + 1;
        if (f.kind === "number") {
          const v = parseNumber(cell);
          bucket.numbers[f.slot]?.push(v);
          if (Number.isInteger(v)) bucket.whole[f.slot] = (bucket.whole[f.slot] ?? 0) + 1;
          if (/0\D*$/.test(cell)) bucket.zeroDigit[f.slot] = (bucket.zeroDigit[f.slot] ?? 0) + 1;
        } else if (f.kind === "category") {
          bucket.levels[f.slot]?.push(f.levels.get(cell) ?? otherLevel);
        } else if (f.kind === "id") {
          bucket.ids[f.slot]?.add(cell);
        }
      }
    },
    ctx.onProgress,
  );
  if (buckets.size === 0) throw new Error("no rows with a timestamp");

  const metrics = defineMetrics(fields);
  let first = Infinity;
  let last = -Infinity;
  for (const index of buckets.keys()) {
    first = Math.min(first, index);
    last = Math.max(last, index);
  }
  const builder = new GridBuilder(metrics.length, ctx.maxGrid);
  const row = new Float64Array(metrics.length);
  const empty = newBucket();
  for (let index = first; index <= last; index++) {
    const bucket = buckets.get(index) ?? empty;
    metrics.forEach((m, i) => {
      row[i] = m.value(bucket);
    });
    builder.push(row, index * bucketMs);
  }
  const built = builder.finish(true);

  const scores = built.values.map(relativeVariance);
  const constant = metrics.map((_, i) => i).slice(1).filter((i) => !(scores[i]! > 0));
  const ranked = metrics
    .map((_, i) => i)
    .slice(1)
    .filter((i) => scores[i]! > 0)
    .sort((a, b) => (scores[b] ?? -1) - (scores[a] ?? -1) || a - b);
  const kept = [0, ...ranked.slice(0, maxSensors - 1)].sort((a, b) => a - b);
  const keptAliases = aliases(kept.length);
  const families = new Map<string, string[]>();
  kept.forEach((i, k) => {
    const m = /^(.*)\[([^=\]]+)=[^\]]*\]$/.exec(metrics[i]?.name ?? "");
    if (!m) return;
    const key = `${m[1]}[${m[2]}]`;
    families.set(key, [...(families.get(key) ?? []), keptAliases[k]!]);
  });
  const siblings = [...families.values()].filter((set) => set.length >= 2);
  return {
    grid: {
      aliases: keptAliases,
      values: kept.map((i) => built.values[i] as Float64Array),
      n: built.n,
      dt: bucketMs * built.bucket,
      time: built.time,
      episodes: built.episodes,
      siblings,
    },
    t0: built.time?.[0] ?? null,
    sourceNames: kept.map((i) => metrics[i]?.name ?? ""),
    stats: {
      rows,
      columns: header.length,
      rawBytes: ctx.rawBytes,
      quarantined: [...derived.values(), ...constant.map((i) => `${metrics[i]?.name ?? ""} (constant)`)],
      domain: "records",
      bucket: built.bucket,
      episodes: 1,
    },
  };
}
