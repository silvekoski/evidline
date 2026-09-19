import { rmSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { mulberry32 } from "@tpm/core";
import { detectLayout, loadSource, type Source } from "../src/index";
import { isoAt, tempDir, writeCsv } from "./fixture";

const dir = tempDir();
const t0 = Date.parse("2026-03-01T00:00:00Z");
const hourMs = 3_600_000;
const days = 3;
const rowsPerDay = 4000;
afterAll(() => rmSync(dir, { recursive: true, force: true }));

type Category = { name: string; levels: string[] };
const levels = (prefix: string, count: number): string[] => Array.from({ length: count }, (_, i) => `${prefix}${i + 1}`);
const notes = ["gift wrap", "leave at door", "call first", '"fragile, handle with care"'];

function buildRecords(seed: number, categories: Category[]): { header: string[]; rows: (string | number)[][] } {
  const rng = mulberry32(seed);
  const header = ["time", "orderId", ...categories.map((c) => c.name), "net", "tax", "gross", "qty", "note"];
  const rows: (string | number)[][] = [];
  let t = 0;
  let order = 0;
  for (let i = 0; i < days * rowsPerDay; i++) {
    t += -Math.log(1 - rng()) * (86_400_000 / rowsPerDay);
    if (rng() >= 0.03) order++;
    const net = Math.round(rng() * 20000) / 100;
    rows.push([
      isoAt(t0, Math.round(t)),
      `ORD-${String(order).padStart(6, "0")}`,
      ...categories.map((c) => c.levels[Math.floor(rng() * c.levels.length)] ?? ""),
      rng() < 0.05 ? "" : net.toFixed(2),
      (net * 0.24).toFixed(2),
      (net * 1.24).toFixed(2),
      1 + Math.floor(rng() * 5),
      rng() < 0.1 ? "" : (notes[Math.floor(rng() * notes.length)] ?? ""),
    ]);
  }
  return { header, rows };
}

function series(source: Source, name: string): Float64Array {
  const index = source.sourceNames.indexOf(name);
  expect(index, name).toBeGreaterThanOrEqual(0);
  return source.grid.values[index] as Float64Array;
}

const median = (values: Float64Array): number => {
  const sorted = values.filter((v) => !Number.isNaN(v)).sort();
  return sorted[sorted.length >> 1] ?? NaN;
};
const mean = (values: Float64Array): number => {
  const finite = values.filter((v) => !Number.isNaN(v));
  return finite.reduce((a, b) => a + b, 0) / finite.length;
};

describe("records with one category field", () => {
  const { header, rows } = buildRecords(3, [{ name: "terminal", levels: levels("T", 8) }]);
  const path = writeCsv(dir, "records.csv", header, rows);

  it("detects the records layout from irregular timestamps", () => {
    expect(detectLayout(rows.slice(0, 5000).map((r) => r.map(String)), header)).toEqual({ domain: "records", timeColumn: 0, counterColumn: null });
  });

  it("derives metrics per hour bucket", async () => {
    const source = await loadSource(path);
    expect(source.stats.domain).toBe("records");
    expect(source.stats.rows).toBe(days * rowsPerDay);
    expect(source.stats.bucket).toBe(1);
    expect(source.stats.episodes).toBe(1);
    expect(source.stats.quarantined).toContain("gross = net + tax");
    expect(source.stats.quarantined).toContain("orderId.nullRate (constant)");
    expect(source.sourceNames).not.toContain("gross.median");
    expect(source.sourceNames).not.toContain("orderId.nullRate");
    expect(source.grid.dt).toBe(hourMs);
    expect(source.grid.n).toBeGreaterThanOrEqual(days * 24);
    expect(source.grid.n).toBeLessThanOrEqual(days * 24 + 2);
    expect(source.grid.time).toHaveLength(source.grid.n);
    expect(source.t0).toBe(t0);
    expect(source.grid.episodes).toEqual([{ from: 0, to: source.grid.n, n: source.grid.n }]);
    expect(source.grid.aliases[0]).toBe("S01");
    expect(source.sourceNames.length).toBeLessThan(200);
    expect(source.sourceNames.length).toBe(source.grid.values.length);

    expect(median(series(source, "rows.count"))).toBeGreaterThanOrEqual(100);
    const nullRate = mean(series(source, "net.nullRate"));
    expect(nullRate).toBeGreaterThan(0.02);
    expect(nullRate).toBeLessThan(0.1);
    const duplicateRate = mean(series(source, "orderId.duplicateRate"));
    expect(duplicateRate).toBeGreaterThan(0.01);
    expect(duplicateRate).toBeLessThan(0.06);
    expect(mean(series(source, "orderId.distinct"))).toBeGreaterThan(100);
    expect(mean(series(source, "net.median"))).toBeGreaterThan(80);
    expect(mean(series(source, "net.p95"))).toBeGreaterThan(mean(series(source, "net.median")));
    const roundShare = mean(series(source, "net.roundShare"));
    expect(roundShare).toBeGreaterThan(0);
    expect(roundShare).toBeLessThan(0.05);
    expect(mean(series(source, "qty.share[3]"))).toBeCloseTo(0.2, 1);
    expect(mean(series(source, "terminal.share[T1]"))).toBeCloseTo(1 / 8, 1);
    expect(source.stats.quarantined).toContain("terminal.otherShare (constant)");
    expect(mean(series(source, "rows.count[terminal=T3]"))).toBeCloseTo(rowsPerDay / 24 / 8, -1);
    expect(mean(series(source, "net.median[terminal=T3]"))).toBeGreaterThan(60);
    expect(mean(series(source, "note.nullRate"))).toBeCloseTo(0.1, 1);
    expect(mean(series(source, "note.share[gift wrap]"))).toBeGreaterThan(0.15);
    expect(source.stats.quarantined).toContain("orderId.formatViolationRate (constant)");
  });
});

describe("records with many category levels", () => {
  it("caps the sensors at 200", async () => {
    const { header, rows } = buildRecords(4, [
      { name: "terminal", levels: levels("T", 8) },
      { name: "city", levels: levels("city", 12) },
      { name: "channel", levels: levels("ch", 12) },
    ]);
    const path = writeCsv(dir, "records-wide.csv", header, rows);
    const source = await loadSource(path);
    expect(source.sourceNames.length).toBeLessThanOrEqual(200);
    expect(source.grid.aliases).toHaveLength(source.sourceNames.length);
    expect(source.grid.aliases.at(-1)).toBe(`S${source.sourceNames.length}`);
    expect(source.grid.values).toHaveLength(source.sourceNames.length);
    expect(source.sourceNames).toContain("rows.count");
    expect(new Set(source.sourceNames).size).toBe(source.sourceNames.length);
    expect(source.grid.siblings!.some((set) => set.length === 8)).toBe(true);
  });
});
