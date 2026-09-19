import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Grid } from "@tpm/core";
import type { EgressPayload } from "@tpm/schemas";
import { forbiddenNames, payloadVocabulary } from "../src/egress-wiring";
import { fixture, run, type Fixture } from "./fixture";

const grid: Grid = {
  aliases: ["S01"],
  values: [Float64Array.from([10.123, 20.456, 30.789, 40, 50])],
  n: 5,
  dt: null,
  time: null,
  episodes: [{ from: 0, to: 5, n: 5 }],
};

const rulePayload = (sentence: string): EgressPayload => ({
  purpose: "compile_rule",
  sentence,
  dt: null,
  n: 20000,
  catalog: [{ alias: "S01", signalType: "slow", role: "controlled" }],
});

describe("gateway wiring", () => {
  let f: Fixture;
  beforeEach(() => {
    f = fixture();
    f.ctx.db.runs.save(run("0123abcd", { name: "uploads/plant-a.csv", quarantined: ["sample", "faultNumber"] }));
    f.ctx.db.sensors.saveAll([
      { runId: "0123abcd", alias: "S01", index: 0, sourceName: "terminal.share[T3]", fingerprint: {} as never, relations: [], redundancyGroup: null, peers: [], flowIndex: 0 },
      { runId: "0123abcd", alias: "S02", index: 1, sourceName: "rows.count[terminal=T3]", fingerprint: {} as never, relations: [], redundancyGroup: null, peers: [], flowIndex: 1 },
    ]);
    f.ctx.db.grids.save("0123abcd", grid);
  });
  afterEach(() => f.close());

  it("collects the forbidden names of a run", () => {
    expect(forbiddenNames(f.ctx.db, "0123abcd")).toEqual([
      "terminal.share[T3]",
      "rows.count[terminal=T3]",
      "terminal",
      "rows",
      "T3",
      "T3",
      "sample",
      "faultNumber",
      "uploads/plant-a.csv",
      "plant-a",
    ]);
  });

  it("drops a digit-only category value", () => {
    f.ctx.db.sensors.saveAll([
      { runId: "0123abcd", alias: "S03", index: 2, sourceName: "postcode.share[02100]", fingerprint: {} as never, relations: [], redundancyGroup: null, peers: [], flowIndex: 2 },
    ]);
    const names = forbiddenNames(f.ctx.db, "0123abcd");
    expect(names).toContain("postcode.share[02100]");
    expect(names).toContain("postcode");
    expect(names).not.toContain("02100");
  });

  it("drops a column header that equals a payload vocabulary word", async () => {
    f.ctx.db.runs.save(run("89abcdef", { name: "plant-b.csv", quarantined: ["State", "index", "faultNumber"] }));
    f.ctx.db.sensors.saveAll([
      { runId: "89abcdef", alias: "S01", index: 0, sourceName: "Setpoint", fingerprint: {} as never, relations: [], redundancyGroup: null, peers: [], flowIndex: 0 },
      { runId: "89abcdef", alias: "S02", index: 1, sourceName: "Step", fingerprint: {} as never, relations: [], redundancyGroup: null, peers: [], flowIndex: 1 },
      { runId: "89abcdef", alias: "S03", index: 2, sourceName: "reactor_pressure", fingerprint: {} as never, relations: [], redundancyGroup: null, peers: [], flowIndex: 2 },
    ]);
    f.ctx.db.grids.save("89abcdef", grid);
    expect(forbiddenNames(f.ctx.db, "89abcdef")).toEqual(["reactor_pressure", "faultNumber", "plant-b.csv", "plant-b"]);
    for (const word of ["setpoint", "state", "step", "index", "sensor-drift", "verdict", "rerun_without", "diagnosis", "purpose"]) expect(payloadVocabulary.has(word), word).toBe(true);
    const payload: EgressPayload = { purpose: "compile_rule", sentence: "S01 must stay below 20", dt: null, n: 20000, catalog: [{ alias: "S01", signalType: "step", role: "setpoint" }, { alias: "S02", signalType: "state", role: "state" }] };
    const result = await f.ctx.gateway.call("compile_rule", payload, { runId: "89abcdef", inferenceId: null, operatorText: true });
    expect(result).toMatchObject({ ok: true, source: "fallback" });
    expect(f.ctx.db.egress.list("89abcdef")[0]?.guards.find((g) => g.name === "names")).toMatchObject({ pass: true, hits: 0 });
  });

  it("writes off records to sqlite and blocks a leak from the grids table", async () => {
    const ctx = { runId: "0123abcd", inferenceId: null, operatorText: true };
    const ok = await f.ctx.gateway.call("compile_rule", rulePayload("S01 must stay below 20"), ctx);
    expect(ok).toMatchObject({ ok: true, source: "fallback" });
    const leak = await f.ctx.gateway.call("compile_rule", rulePayload("S01 read 10.1 20.5 30.8"), ctx);
    expect(leak.ok).toBe(false);
    const name = await f.ctx.gateway.call("compile_rule", rulePayload("S01 must stay below 20 at plant-a"), ctx);
    expect(name.ok).toBe(false);
    const records = f.ctx.db.egress.list("0123abcd");
    expect(records.map((r) => r.status)).toEqual(["blocked", "blocked", "off"]);
    expect(records.every((r) => r.id.startsWith("eg-"))).toBe(true);
    expect(records[0]?.guards.find((g) => g.name === "names")).toMatchObject({ pass: false, hits: 1 });
    expect(records[1]?.guards.find((g) => g.name === "leak")).toMatchObject({ pass: false, hits: 1 });
  });
});
