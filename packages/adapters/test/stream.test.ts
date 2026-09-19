import { rmSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { mulberry32 } from "@tpm/core";
import { detectLayout, loadSource } from "../src/index";
import { isoAt, tempDir, writeCsv } from "./fixture";

const dir = tempDir();
const t0 = Date.parse("2026-01-01T00:00:00Z");
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("stream with an ISO time column", () => {
  const rng = mulberry32(1);
  const rows = Array.from({ length: 2000 }, (_, i) => [
    isoAt(t0, i * 60_000),
    Math.sin(i / 50).toFixed(5),
    (i * 0.01 + rng()).toFixed(4),
    (rng() * 100).toFixed(2),
  ]);
  const path = writeCsv(dir, "iso-stream.csv", ["time", "temp", "level", "flow"], rows);

  it("detects the stream layout and the time column", () => {
    expect(detectLayout(rows.slice(0, 500), ["time", "temp", "level", "flow"])).toEqual({ domain: "stream", timeColumn: 0, counterColumn: null });
  });

  it("builds the grid with t0, dt and a time array", async () => {
    const source = await loadSource(path);
    expect(source.stats.domain).toBe("stream");
    expect(source.t0).toBe(t0);
    expect(source.grid.dt).toBe(60_000);
    expect(source.grid.n).toBe(2000);
    expect(source.grid.time).toHaveLength(2000);
    expect(source.grid.time?.[1]).toBe(t0 + 60_000);
    expect(source.grid.aliases).toEqual(["S01", "S02", "S03"]);
    expect(source.sourceNames).toEqual(["temp", "level", "flow"]);
    expect(source.stats.quarantined).toEqual([]);
    expect(source.stats.bucket).toBe(1);
    expect(source.stats.rows).toBe(2000);
    expect(source.stats.columns).toBe(4);
    expect(source.grid.episodes).toEqual([{ from: 0, to: 2000, n: 2000 }]);
    expect(source.grid.values[0]?.[3]).toBeCloseTo(Math.sin(3 / 50), 5);
  });
});

describe("stream with a counter column and episode metadata", () => {
  const rng = mulberry32(2);
  const rows: (string | number)[][] = [];
  for (let episode = 0; episode < 3; episode++) {
    for (let sample = 1; sample <= 400; sample++) {
      rows.push([episode + 1, sample, `run ${episode + 1}`, episode * 10, (rng() * 5).toFixed(3), (sample * 0.1 + rng()).toFixed(3), rng() > 0.5 ? 1 : 0]);
    }
  }
  const header = ["run", "sample", "label", "fault", "a", "b", "flag"];
  const path = writeCsv(dir, "counter-stream.csv", header, rows);

  it("finds the counter column", () => {
    expect(detectLayout(rows.slice(0, 1000).map((r) => r.map(String)), header)).toEqual({ domain: "stream", timeColumn: null, counterColumn: 1 });
  });

  it("splits episodes and quarantines metadata and text", async () => {
    const source = await loadSource(path);
    expect(source.grid.episodes).toEqual([
      { from: 0, to: 400, n: 400 },
      { from: 400, to: 800, n: 800 - 400 },
      { from: 800, to: 1200, n: 400 },
    ]);
    expect(source.stats.episodes).toBe(3);
    expect([...source.stats.quarantined].sort()).toEqual(["fault", "label", "run"]);
    expect(source.sourceNames).toEqual(["a", "b", "flag"]);
    expect(source.grid.aliases).toEqual(["S01", "S02", "S03"]);
    expect(source.grid.dt).toBeNull();
    expect(source.grid.time).toBeNull();
    expect(source.t0).toBeNull();
  });
});

describe("stream with many short episodes", () => {
  const rng = mulberry32(3);
  const rows: (string | number)[][] = [];
  for (let episode = 0; episode < 100; episode++) {
    for (let sample = 1; sample <= 12; sample++) {
      rows.push([episode + 1, sample, (rng() * 5).toFixed(3), (sample * 0.1 + rng()).toFixed(3)]);
    }
  }
  const path = writeCsv(dir, "short-episodes.csv", ["run", "sample", "a", "b"], rows);

  it("merges the episodes into one window and keeps the count in stats", async () => {
    const source = await loadSource(path);
    expect(source.stats.episodes).toBe(100);
    expect(source.grid.episodes).toEqual([{ from: 0, to: 1200, n: 1200 }]);
  });
});

describe("large stream", () => {
  it("downsamples with a power-of-2 bucket", async () => {
    const rows = Array.from({ length: 300_000 }, (_, i) => [isoAt(t0, i * 1000), i * 2, (i % 7).toFixed(1), i % 2 === 0 ? "" : i % 3]);
    const path = writeCsv(dir, "large-stream.csv", ["time", "ramp", "saw", "sparse"], rows);
    const source = await loadSource(path, { maxGrid: 150_000 });
    expect(source.stats.bucket).toBe(2);
    expect(source.grid.n).toBe(150_000);
    expect(source.grid.dt).toBe(2000);
    expect(source.grid.time).toHaveLength(150_000);
    expect(source.grid.time?.[0]).toBe(t0);
    expect(source.grid.time?.[1]).toBe(t0 + 2000);
    expect(source.grid.values[0]?.[5]).toBe(21);
    expect(source.grid.values[2]?.[5]).toBe(2);
    expect(source.sourceNames).toEqual(["ramp", "saw", "sparse"]);
    expect(source.stats.rows).toBe(300_000);
    expect(source.grid.episodes).toEqual([{ from: 0, to: 150_000, n: 150_000 }]);
  });
});

describe("European number formats", () => {
  it("parses decimal commas and space thousands separators", async () => {
    const rows = Array.from({ length: 200 }, (_, i) => [`${i},5`, `1 ${String(200 + i).padStart(3, "0")},25`, `${(i * 0.5).toFixed(2).replace(".", ",")}`]);
    const path = writeCsv(dir, "european.csv", ["a", "b", "c"], rows, ";");
    const source = await loadSource(path);
    expect(source.stats.domain).toBe("stream");
    expect(source.sourceNames).toEqual(["a", "b", "c"]);
    expect(source.grid.values[0]?.[3]).toBe(3.5);
    expect(source.grid.values[1]?.[0]).toBe(1200.25);
    expect(source.grid.values[2]?.[3]).toBe(1.5);
  });
});
