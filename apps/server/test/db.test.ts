import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Grid } from "@tpm/core";
import type { Evidence, Inference } from "@tpm/schemas";
import { inferenceId, newEgressId, newRuleId, newRunId, newThreadId } from "../src/ids";
import { fixture, run, type Fixture } from "./fixture";

const grid: Grid = {
  aliases: ["S01", "S02"],
  values: [Float64Array.from([1, 2, NaN, 4, 5, 6]), Float64Array.from([10, 20, 30, 40, 50, 60])],
  n: 6,
  dt: 180000,
  time: Float64Array.from([0, 180000, 360000, 540000, 720000, 900000]),
  episodes: [
    { from: 0, to: 4, n: 4 },
    { from: 4, to: 6, n: 2 },
  ],
};

describe("repositories", () => {
  let f: Fixture;
  beforeEach(() => {
    f = fixture();
    f.ctx.db.runs.save(run("0123abcd"));
  });
  afterEach(() => f.close());

  it("round-trips a grid with time and episodes", () => {
    f.ctx.db.grids.save("0123abcd", grid);
    const loaded = f.ctx.db.grids.load("0123abcd");
    expect(loaded).toEqual(grid);
    expect(loaded?.values[0]).toBeInstanceOf(Float64Array);
    expect(f.ctx.db.grids.series("0123abcd").map((s) => s.alias)).toEqual(["S01", "S02"]);
    expect(f.ctx.db.grids.load("nope")).toBeNull();
  });

  it("round-trips the sibling sets of a records grid", () => {
    const records: Grid = { ...grid, aliases: ["S01", "S02", "S03", "S04"], values: [...grid.values, ...grid.values], siblings: [["S02", "S04"]] };
    f.ctx.db.grids.save("0123abcd", records);
    expect(f.ctx.db.grids.load("0123abcd")).toEqual(records);
    expect(f.ctx.db.grids.series("0123abcd").map((s) => s.alias)).toEqual(["S01", "S02", "S03", "S04"]);
  });

  it("stores evidence with derived series and inferences by stage", () => {
    const evidence: Evidence = {
      id: "ev-0123abcd-00001",
      runId: "0123abcd",
      kind: "residual",
      sensors: ["S01"],
      window: { from: 0, to: 6, n: 6 },
      method: "huber",
      stats: { sigma: 0.5 },
      verdict: "drifting",
      chart: { type: "line", window: { from: 0, to: 6, n: 6 }, series: [{ key: "expected", label: "expected", source: { derived: "expected" }, style: "dashed" }] },
    };
    f.ctx.db.evidence.saveAll([evidence]);
    f.ctx.db.evidence.saveSeries(evidence.id, { expected: Float64Array.from([1, 2, 3]) });
    expect(f.ctx.db.evidence.get(evidence.id)).toEqual(evidence);
    expect(f.ctx.db.evidence.list("0123abcd")).toHaveLength(1);
    expect(f.ctx.db.evidence.series(evidence.id, 3)).toEqual({ expected: Float64Array.from([1, 2, 3]) });
    const long = Float64Array.from({ length: 10000 }, (_, i) => i);
    f.ctx.db.evidence.saveSeries(evidence.id, { deviation: long });
    const stored = f.ctx.db.evidence.series(evidence.id, 10000).deviation!;
    expect(stored).toHaveLength(10000);
    expect(stored[0]).toBeCloseTo(1, 5);
    expect(Math.abs((stored[9999] ?? 0) - 9999)).toBeLessThan(3);
    const role: Inference = {
      id: inferenceId("0123abcd", 2),
      runId: "0123abcd",
      sensor: "S01",
      claim: "S01 is an actuator",
      confidence: 0.6,
      evidenceIds: [evidence.id],
      status: "proposed",
      supersedes: null,
      seq: 2,
      stage: "role",
      value: {
        sensor: "S01",
        role: "actuator",
        scores: { setpoint: 0, controlled: 0.2, actuator: 0.8, redundant: 0, upstream: 0, downstream: 0, counter: 0, state: 0, unknown: 0 },
        hypothesisName: null,
        hypothesisConfidence: null,
      },
    };
    const baseline: Inference = { ...role, id: inferenceId("0123abcd", 1), seq: 1, sensor: null, stage: "baseline", value: { window: { from: 0, to: 4, n: 4 }, changepoints: [4] } };
    f.ctx.db.inferences.saveAll([role, baseline]);
    expect(f.ctx.db.inferences.list("0123abcd").map((i) => i.seq)).toEqual([1, 2]);
    expect(f.ctx.db.inferences.list("0123abcd", "role")).toEqual([role]);
    expect(f.ctx.db.inferences.get(baseline.id)).toEqual(baseline);
  });

  it("makes ids of the right shape", () => {
    expect(newRunId()).toMatch(/^[0-9a-f]{8}$/);
    expect(new Set(Array.from({ length: 50 }, newRunId)).size).toBe(50);
    expect(inferenceId("0123abcd", 7)).toBe("inf-0123abcd-00007");
    expect(newThreadId()).toMatch(/^th-[0-9a-f]{12}$/);
    expect(newEgressId()).toMatch(/^eg-[0-9a-f]{12}$/);
    expect(newRuleId()).toMatch(/^rule-[0-9a-f]{12}$/);
  });
});
