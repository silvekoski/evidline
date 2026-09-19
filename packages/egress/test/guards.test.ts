import type { EgressPayload } from "@tpm/schemas";
import { describe, expect, it } from "vitest";
import { buildLeakIndex, floorGuard, payloadGuards, roundPayload, sizeGuard } from "../src/index";
import { compileRulePayload, evidenceId, explainPayload, healthStep, nameRolePayload, sensorSummary, testGateway } from "./fixtures";

const index = buildLeakIndex([{ alias: "S01", values: Float64Array.from([1.23456, 4.56789, 7.89012, 2.5, 3.5]) }], ["xmeas_1", "plant-b"]);
const guardOrder = ["schema", "floor", "size", "rounding", "leak", "names"];

async function blockedBy(payload: unknown) {
  const { gateway, store } = testGateway({ mode: "cloud", index });
  const purpose = (payload as EgressPayload).purpose;
  const result = await gateway.call(purpose, payload as EgressPayload, { runId: "0123abcd", inferenceId: null, operatorText: false });
  const record = store.records[0];
  expect(result.ok).toBe(false);
  expect(record?.status).toBe("blocked");
  const names = record?.guards.map((g) => g.name) ?? [];
  expect(names).toEqual([...guardOrder.slice(0, names.length - 1), "record"]);
  const failed = record?.guards.filter((g) => !g.pass) ?? [];
  expect(failed).toHaveLength(1);
  return { guard: failed[0]?.name, result, record };
}

describe("guards in PRD order", () => {
  it("run in order and all pass on a clean payload", () => {
    const text = JSON.stringify(roundPayload(nameRolePayload));
    const results = payloadGuards.map((g) => g({ purpose: "name_role", payload: nameRolePayload, text, index }));
    expect(results.map((r) => r.name)).toEqual(guardOrder);
    expect(results.every((r) => r.pass)).toBe(true);
  });

  it("blocks an unknown key at the schema guard", async () => {
    const { guard, result } = await blockedBy({ ...nameRolePayload, sourceName: "xmeas_1" });
    expect(guard).toBe("schema");
    expect(result.ok === false && result.reason).toContain("schema guard failed");
  });

  it("blocks a payload whose purpose differs from the call", async () => {
    const { gateway, store } = testGateway({ mode: "cloud", index });
    const result = await gateway.call("compile_rule", nameRolePayload, { runId: null, inferenceId: null, operatorText: false });
    expect(result.ok).toBe(false);
    expect(store.records[0]?.guards[0]).toMatchObject({ name: "schema", pass: false });
  });

  it("blocks an n of 50 at the schema guard, and the floor guard also rejects it", async () => {
    const { guard } = await blockedBy({ ...nameRolePayload, sensor: { ...sensorSummary, n: 50 } });
    expect(guard).toBe("schema");
    const hidden = { ...explainPayload, trace: [{ ...healthStep, stats: { n: 50 } }] };
    const input = { purpose: "explain_diagnosis" as const, text: "", index };
    expect(floorGuard({ ...input, payload: hidden })).toMatchObject({ name: "floor", pass: false });
    expect(floorGuard({ ...input, payload: explainPayload })).toMatchObject({ name: "floor", pass: true });
  });

  it("blocks an array of 21 numbers at the schema guard, and the size guard also rejects it", async () => {
    const long = { ...sensorSummary, histogramShares: Array.from({ length: 21 }, () => 0.05) };
    const { guard } = await blockedBy({ ...nameRolePayload, sensor: long });
    expect(guard).toBe("schema");
    const input = { purpose: "name_role" as const, index };
    expect(sizeGuard({ ...input, payload: long, text: "{}" })).toMatchObject({ name: "size", pass: false });
    expect(sizeGuard({ ...input, payload: sensorSummary, text: "x".repeat(8193) })).toMatchObject({ name: "size", pass: false });
    expect(sizeGuard({ ...input, payload: sensorSummary, text: "x".repeat(8192) })).toMatchObject({ name: "size", pass: true });
  });

  it("blocks a 9 KB payload at the size guard", async () => {
    const stats = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`statistic_number_${String(i).padStart(2, "0")}_of_step`, 0.5]));
    const result = "The block statistic stays under its limit. ".repeat(6).trim();
    const trace = Array.from({ length: 20 }, (_, i) => ({ ...healthStep, index: i, stats, result, evidenceIds: [evidenceId(1)] }));
    const big = { ...explainPayload, trace };
    expect(JSON.stringify(big).length).toBeGreaterThan(9000);
    const { guard } = await blockedBy(big);
    expect(guard).toBe("size");
  });

  it("blocks a planted triple of raw values in prose and in a JSON array", async () => {
    const prose = await blockedBy(compileRulePayload("S03 read 1.23, 4.57, 7.89 this morning"));
    expect(prose.guard).toBe("leak");
    expect(prose.record?.guards.find((g) => g.name === "leak")?.hits).toBe(1);
    const array = await blockedBy({ ...nameRolePayload, sensor: { ...sensorSummary, histogramShares: [1.23456, 4.56789, 7.89012] } });
    expect(array.guard).toBe("leak");
  });

  it("blocks a planted source name at the names guard", async () => {
    const { guard, record } = await blockedBy(compileRulePayload("Xmeas_1 must stay below 20"));
    expect(guard).toBe("names");
    expect(record?.guards.find((g) => g.name === "names")?.hits).toBe(1);
  });
});
