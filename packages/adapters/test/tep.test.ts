import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadSource } from "../src/index";

const tep = fileURLToPath(new URL("../../../data/tep-subset.csv", import.meta.url));

describe.skipIf(!existsSync(tep))("TEP subset", () => {
  it("loads as a stream with 52 sensors and merges the 80 short episodes", async () => {
    const start = performance.now();
    const progress: number[] = [];
    const source = await loadSource(tep, { onProgress: (rows) => progress.push(rows) });
    expect(performance.now() - start).toBeLessThan(15_000);
    expect(source.stats.domain).toBe("stream");
    expect(source.grid.aliases).toHaveLength(52);
    expect(source.sourceNames[0]).toBe("xmeas_1");
    expect(source.sourceNames[51]).toBe("xmv_11");
    expect([...source.stats.quarantined].sort()).toEqual(["faultNumber", "fault_status", "simulationRun", "source"]);
    expect(source.stats.episodes).toBe(80);
    expect(source.grid.episodes).toHaveLength(1);
    expect(source.grid.episodes[0]).toEqual({ from: 0, to: 76_800, n: 76_800 });
    expect(source.grid.n).toBe(76_800);
    expect(source.grid.dt).toBeNull();
    expect(source.t0).toBeNull();
    expect(source.stats.bucket).toBe(1);
    expect(source.stats.rows).toBe(76_800);
    expect(source.stats.columns).toBe(57);
    expect(progress.at(-1)).toBe(76_800);
    expect(source.grid.values[0]?.[0]).toBeCloseTo(0.25171, 5);
  });
});
