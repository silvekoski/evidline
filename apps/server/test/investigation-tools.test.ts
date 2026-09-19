import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fingerprint, window, type Grid } from "@tpm/core";
import { Evidence } from "@tpm/schemas";
import { executeTool } from "../src/investigation-tools";
import { verifyLog } from "../src/log";
import { fixture, run, type Fixture } from "./fixture";

const runId = "1234abcd";
const grid: Grid = { aliases: ["S01", "S02"], values: [Float64Array.from({ length: 100 }, (_, i) => i < 50 ? 0 : 10), Float64Array.from({ length: 100 }, (_, i) => i)], n: 100, dt: null, time: null, episodes: [window(0, 100)] };

describe("local investigation tools", () => {
  let f: Fixture;
  beforeEach(() => {
    f = fixture();
    f.ctx.db.runs.save(run(runId, { gridSize: grid.n, timeBase: { t0: null, dt: null, n: grid.n } }));
    f.ctx.db.grids.save(runId, grid);
    f.ctx.db.sensors.saveAll(grid.aliases.map((alias, index) => ({ runId, alias, index, sourceName: alias, fingerprint: fingerprint(grid.values[index]!, grid.episodes), relations: [], redundancyGroup: null, peers: [], flowIndex: null })));
  });
  afterEach(() => f.close());

  it("compares clipped windows with durable, distinct evidence and valid audit records", async () => {
    const call = { tool: "compare_windows" as const, sensor: "S01", a: { from: 0, to: 50 }, b: { from: 50, to: 9999 } };
    const first = await executeTool(f.ctx, runId, call, {});
    const second = await executeTool(f.ctx, runId, call, {});
    expect(first.evidenceIds).not.toEqual(second.evidenceIds);
    const evidence = Evidence.parse(f.ctx.db.evidence.get(first.evidenceIds[0]!));
    expect(evidence.stats).toMatchObject({ aMedian: 0, bMedian: 10, wasserstein: 10, bTo: 100 });
    expect(evidence.window).toEqual(window(0, 100));
    expect(verifyLog(f.ctx.db).ok).toBe(true);
  });

  it("finds the planted change and handles empty clipped windows", async () => {
    const result = await executeTool(f.ctx, runId, { tool: "find_changepoints", sensor: "S01", near: 50, span: 9999 }, {});
    expect(f.ctx.db.evidence.get(result.evidenceIds[0]!)?.chart.marks?.map((m) => m.at)).toContain(50);
    const empty = await executeTool(f.ctx, runId, { tool: "compare_windows", sensor: "S01", a: { from: 999, to: 1000 }, b: { from: 1000, to: 1001 } }, {});
    expect(Evidence.parse(f.ctx.db.evidence.get(empty.evidenceIds[0]!)).window).toEqual(window(100, 100));
  });

  it("calculates correlation and counts only violations within the requested window", async () => {
    const relation = await executeTool(f.ctx, runId, { tool: "test_relation", a: "S02", b: "S02", window: { from: 0, to: 100 } }, {});
    expect(f.ctx.db.evidence.get(relation.evidenceIds[0]!)?.stats.rho).toBe(1);
    const rule = await executeTool(f.ctx, runId, { tool: "check_rule", rule: { type: "range", sensor: "S02", min: 0, max: 60, source: "test" }, window: { from: 50, to: 70 } }, {});
    expect(f.ctx.db.evidence.get(rule.evidenceIds[0]!)?.stats.violations).toBe(9);
  });

  it("scores a requested role against the persisted signal and supplies fresh evidence", async () => {
    const result = await executeTool(f.ctx, runId, { tool: "test_role", sensor: "S02", role: "counter" }, {});
    expect(result.role?.value.role).toBe("counter");
    expect(result.role?.value.scores.counter).toBe(1);
    expect(result.evidenceIds.length).toBeGreaterThan(0);
    for (const id of result.evidenceIds) expect(Evidence.safeParse(f.ctx.db.evidence.get(id)).success).toBe(true);
  });

  it("reruns in a worker without overwriting evidence and rewrites result references", async () => {
    const initial = await executeTool(f.ctx, runId, { tool: "compare_windows", sensor: "S01", a: { from: 0, to: 50 }, b: { from: 50, to: 100 } }, {});
    const original = f.ctx.db.evidence.get(initial.evidenceIds[0]!);
    const rerun = await executeTool(f.ctx, runId, { tool: "rerun_without", sensor: "S01" }, {});
    expect(f.ctx.db.evidence.get(initial.evidenceIds[0]!)).toEqual(original);
    expect(rerun.result?.baseline.evidenceIds.length).toBeGreaterThan(0);
    for (const id of rerun.result!.baseline.evidenceIds) {
      expect(rerun.evidenceIds).toContain(id);
      expect(f.ctx.db.evidence.get(id)?.method).not.toBe("compare_windows");
    }
    expect(rerun.result?.graph.peers).toBeInstanceOf(Map);
    expect(verifyLog(f.ctx.db).ok).toBe(true);
  });

  it("rejects unknown primary and relation sensor aliases before creating evidence", async () => {
    await expect(executeTool(f.ctx, runId, { tool: "rerun_without", sensor: "S99" }, {})).rejects.toMatchObject({ status: 422 });
    await expect(executeTool(f.ctx, runId, { tool: "check_rule", rule: { type: "relation", sensor: "S01", sensor2: "S99", relation: "tracks", tolerance: 1, source: "test" }, window: { from: 0, to: 100 } }, {})).rejects.toMatchObject({ status: 422 });
    expect(f.ctx.db.evidence.count(runId)).toBe(0);
  });
});
