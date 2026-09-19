import { parseNumber } from "./parse-number";
import { parseTime, type TimeUnit } from "./parse-time";

export type ColumnKind = "timestamp" | "counter" | "number" | "id" | "category" | "text" | "empty";

export type ColumnProfile = {
  name: string;
  kind: ColumnKind;
  numeric: boolean;
  timeUnit: TimeUnit | null;
  medianStep: number;
  regular: boolean;
  distinct: number;
  levels: string[];
  pattern: string;
};

export const maxLevels = 12;

export function shape(text: string): string {
  return text.replace(/\p{L}+/gu, "A").replace(/\d+/g, "9").replace(/\s+/g, " ");
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const upper = sorted[mid] ?? NaN;
  return sorted.length % 2 === 1 ? upper : ((sorted[mid - 1] ?? NaN) + upper) / 2;
}

export function profileColumns(sample: string[][], header: string[]): ColumnProfile[] {
  return header.map((name, i) => profileColumn(name, sample.map((row) => (row[i] ?? "").trim())));
}

function profileColumn(name: string, cells: string[]): ColumnProfile {
  const filled = cells.filter((cell) => cell !== "");
  const ranked = rankByCount(filled);
  const [pattern = "", patternCount = 0] = rankByCount(filled.map(shape))[0] ?? [];
  const base = {
    name,
    numeric: false,
    timeUnit: null,
    medianStep: NaN,
    regular: false,
    distinct: ranked.length,
    levels: ranked.slice(0, maxLevels).map(([value]) => value),
    pattern,
  };
  if (filled.length === 0) return { ...base, kind: "empty" };
  const numbers = filled.map(parseNumber);
  const finite = numbers.filter(Number.isFinite);
  const numeric = finite.length >= 0.9 * filled.length;
  const timeUnit = timeUnitOf(filled, finite, numeric);
  if (timeUnit !== null) {
    const times = filled.map((cell) => parseTime(cell, timeUnit)).filter(Number.isFinite);
    const steps = times.slice(1).map((t, i) => t - (times[i] ?? NaN));
    const medianStep = median(steps);
    const near = steps.filter((s) => Math.abs(s - medianStep) <= 0.5 * medianStep).length;
    return { ...base, kind: "timestamp", numeric, timeUnit, medianStep, regular: medianStep > 0 && near >= 0.8 * steps.length };
  }
  if (!numeric) {
    const ratio = ranked.length / filled.length;
    const id = ratio >= 0.9 && filled.length >= 20 && patternCount >= 0.9 * filled.length;
    return { ...base, kind: ratio <= 0.2 ? "category" : id ? "id" : "text" };
  }
  const integers = finite.every(Number.isInteger);
  if (integers && finite.length === filled.length && isCounter(finite)) return { ...base, kind: "counter", numeric };
  if (integers && ranked.length <= maxLevels && filled.length >= 50) return { ...base, kind: "category", numeric };
  if (integers && ranked.length >= 0.9 * filled.length && filled.length >= 100) return { ...base, kind: "id", numeric };
  return { ...base, kind: "number", numeric };
}

function rankByCount(values: string[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
}

function timeUnitOf(filled: string[], finite: number[], numeric: boolean): TimeUnit | null {
  const iso = filled.filter((cell) => Number.isFinite(parseTime(cell, "iso"))).length;
  if (iso >= 0.9 * filled.length) return "iso";
  if (!numeric || finite.length < 2) return null;
  const unit = finite.every((v) => v >= 3e8 && v <= 4e9) ? "s" : finite.every((v) => v >= 3e11 && v <= 4e12) ? "ms" : null;
  if (unit === null) return null;
  let forward = 0;
  for (let i = 1; i < finite.length; i++) if ((finite[i] ?? 0) >= (finite[i - 1] ?? 0)) forward++;
  return forward >= 0.95 * (finite.length - 1) ? unit : null;
}

function isCounter(values: number[]): boolean {
  if (values.length < 2) return false;
  let ones = 0;
  let resets = 0;
  for (let i = 1; i < values.length; i++) {
    const step = (values[i] ?? 0) - (values[i - 1] ?? 0);
    if (step === 1) ones++;
    else if (step < 0) resets++;
  }
  const steps = values.length - 1;
  return ones >= 0.9 * steps && ones + resets >= 0.99 * steps;
}
