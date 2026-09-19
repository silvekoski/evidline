import { Purpose, type EgressPayload } from "@tpm/schemas";
import { describe, expect, it } from "vitest";
import { createGateway, buildLeakIndex, templates } from "../src/index";
import {
  capturingProvider,
  compileRulePayload,
  explainPayload,
  nameRolePayload,
  planPayload,
  replies,
  reviewPayload,
  searchPayload,
  testGateway,
} from "./fixtures";

const ctx = { runId: "0123abcd", inferenceId: "inf-0123abcd-00001", operatorText: false };
const payloads: Record<Purpose, EgressPayload> = {
  name_role: nameRolePayload,
  compile_rule: compileRulePayload("S03 must stay below 20"),
  explain_diagnosis: explainPayload,
  plan_investigation: planPayload("drift", undefined, "S03", "S04"),
  search: searchPayload(),
  cross_review: reviewPayload,
};

const reviewer = (model: string, reply: () => string) => ({ ...capturingProvider(reply), model, name: "review", host: "review.local" });

describe("gateway with a mock provider", () => {
  it.each(Purpose.options)("sends the recorded payload string for %s", async (purpose) => {
    const provider = capturingProvider((p) => replies[p] as string);
    const { gateway, store } = testGateway({ mode: "cloud", provider });
    const result = await gateway.call(purpose, payloads[purpose], ctx);
    expect(result).toMatchObject({ ok: true, source: "model", recordId: "eg-001" });
    const record = store.records[0];
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.payloadText).toBe(record?.payload);
    expect(provider.calls[0]?.template).toBe(templates()[purpose].text);
    expect(record).toMatchObject({
      status: "sent",
      purpose,
      mode: "cloud",
      runId: "0123abcd",
      inferenceId: "inf-0123abcd-00001",
      templateHash: templates()[purpose].hash,
      response: replies[purpose],
      provider: { name: "mock", model: "mock-1", region: null, host: "http://mock.local" },
    });
    expect(record?.guards.map((g) => g.name)).toEqual(["schema", "floor", "size", "rounding", "leak", "names", "record"]);
    expect(record?.guards.every((g) => g.pass)).toBe(true);
    expect(record?.payloadBytes).toBe(Buffer.byteLength(record?.payload ?? ""));
    expect(typeof record?.durationMs).toBe("number");
  });

  it("rounds the payload before it leaves and records the rounded bytes", async () => {
    const provider = capturingProvider((p) => replies[p] as string);
    const { gateway, store } = testGateway({ mode: "cloud", provider });
    const sensor = nameRolePayload.purpose === "name_role" ? nameRolePayload.sensor : null;
    await gateway.call("name_role", { ...nameRolePayload, sensor: { ...sensor, mad: 0.123456, n: 12345 } } as EgressPayload, ctx);
    const sent = JSON.parse(provider.calls[0]?.payloadText ?? "") as { sensor: { mad: number; n: number } };
    expect(sent.sensor.mad).toBe(0.123);
    expect(sent.sensor.n).toBe(12345);
    expect(store.records[0]?.payload).toContain('"mad":0.123');
  });

  it("writes an error record when the response fails the response schema", async () => {
    const reply = JSON.stringify({ name: "x".repeat(61), quantity: "q", confidence: 2, reason: "r" });
    const { gateway, store } = testGateway({ mode: "cloud", provider: capturingProvider(() => reply) });
    const result = await gateway.call("name_role", nameRolePayload, ctx);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("response schema");
    expect(store.records[0]).toMatchObject({ status: "error", response: reply });
  });

  it("writes an error record when the provider throws and when the response is not JSON", async () => {
    const throwing = capturingProvider(() => {
      throw new Error("azure 401: bad key");
    });
    const { gateway, store } = testGateway({ mode: "cloud", provider: throwing });
    const result = await gateway.call("name_role", nameRolePayload, ctx);
    expect(result).toMatchObject({ ok: false, recordId: "eg-001", reason: "mock call failed: azure 401: bad key" });
    expect(store.records[0]).toMatchObject({ status: "error", response: "azure 401: bad key" });
    const text = testGateway({ mode: "local", provider: capturingProvider(() => "not json") });
    const bad = await text.gateway.call("name_role", nameRolePayload, ctx);
    expect(bad.ok === false && bad.reason).toContain("not JSON");
    expect(text.store.records[0]).toMatchObject({ status: "error", mode: "local", response: "not json" });
  });

  it("writes an error record when the mode has no provider", async () => {
    const { gateway, store } = testGateway({ mode: "cloud", provider: null });
    const result = await gateway.call("name_role", nameRolePayload, ctx);
    expect(result).toMatchObject({ ok: false, reason: "no provider configured for mode cloud" });
    expect(store.records[0]).toMatchObject({ status: "error", provider: null });
  });

  it("does not send when the record write fails", async () => {
    const provider = capturingProvider((p) => replies[p] as string);
    const gateway = createGateway({
      store: {
        write: () => {
          throw new Error("disk full");
        },
        update: () => undefined,
      },
      getMode: () => "cloud",
      resolveProvider: () => provider,
      leakIndex: () => buildLeakIndex([], []),
      nowIso: () => "2026-09-19T12:00:00Z",
      newId: () => "eg-x",
    });
    const result = await gateway.call("name_role", nameRolePayload, ctx);
    expect(result).toEqual({ ok: false, recordId: null, reason: "record write failed: disk full" });
    expect(provider.calls).toHaveLength(0);
  });

  it("flags operator text and keeps a null run id", async () => {
    const provider = capturingProvider((p) => replies[p] as string);
    const { gateway, store } = testGateway({ mode: "cloud", provider });
    await gateway.call("compile_rule", payloads.compile_rule, { runId: null, inferenceId: null, operatorText: true });
    expect(store.records[0]).toMatchObject({ runId: null, inferenceId: null, operatorText: true });
  });

  it("exposes the templates with sha256 hashes", () => {
    const { gateway } = testGateway({ mode: "off" });
    const info = gateway.templates();
    for (const purpose of Purpose.options) {
      expect(info[purpose].hash).toMatch(/^[0-9a-f]{64}$/);
      expect(info[purpose].text).toBe(templates[purpose]);
      expect(info[purpose].text).toContain("Reply with one JSON object");
      if (purpose !== "search") expect(info[purpose].text).toContain("grid samples");
    }
    expect(new Set(Object.values(info).map((t) => t.hash)).size).toBe(Purpose.options.length);
  });

  it("strips a leading think block and code fences before the parse and keeps the raw response", async () => {
    const raw = '<think>weigh S05</think>\n```json\n{"faultClass":"sensor-dead","confidence":0.8,"summary":"<think> is a word here","concerns":[]}\n```';
    const { gateway, store } = testGateway({ mode: "cloud", provider: capturingProvider(() => raw) });
    const result = await gateway.call<{ summary: string }>("cross_review", reviewPayload, ctx);
    expect(result.ok && result.value.summary).toBe("<think> is a word here");
    expect(store.records[0]?.response).toBe(raw);
  });
});

describe("gateway with reviewers", () => {
  it("routes a call to the named reviewer and records that provider", async () => {
    const a = reviewer("model-a", () => replies.cross_review as string);
    const b = reviewer("model-b", () => replies.cross_review as string);
    const { gateway, store } = testGateway({ mode: "cloud", provider: capturingProvider(() => ""), reviewers: [a, b] });
    expect(gateway.reviewers().map((r) => r.model)).toEqual(["model-a", "model-b"]);
    const result = await gateway.call("cross_review", reviewPayload, ctx, "model-b");
    expect(result).toMatchObject({ ok: true, source: "model" });
    expect(b.calls).toHaveLength(1);
    expect(a.calls).toHaveLength(0);
    expect(store.records[0]?.provider).toEqual({ name: "review", model: "model-b", region: null, host: "review.local" });
  });

  it("writes an error record for an unknown reviewer", async () => {
    const { gateway, store } = testGateway({ mode: "cloud", reviewers: [reviewer("model-a", () => "")] });
    const result = await gateway.call("cross_review", reviewPayload, ctx, "model-x");
    expect(result).toEqual({ ok: false, recordId: "eg-001", reason: "no reviewer model-x" });
    expect(store.records[0]).toMatchObject({ status: "error", provider: null, response: "no reviewer model-x" });
  });

  it("has no reviewers outside mode cloud and never sends", async () => {
    const a = reviewer("model-a", () => replies.cross_review as string);
    const local = testGateway({ mode: "local", provider: capturingProvider(() => ""), reviewers: [a] });
    expect(local.gateway.reviewers()).toEqual([]);
    const result = await local.gateway.call("cross_review", reviewPayload, ctx, "model-a");
    expect(result).toEqual({ ok: false, recordId: "eg-001", reason: "reviewers need mode cloud" });
    expect(local.store.records[0]).toMatchObject({ status: "error", provider: null, mode: "local" });
    const off = testGateway({ mode: "off", reviewers: [a] });
    const offResult = await off.gateway.call("cross_review", reviewPayload, ctx, "model-a");
    expect(offResult).toEqual({ ok: false, recordId: "eg-001", reason: "no fallback for cross_review, model off" });
    expect(off.store.records[0]).toMatchObject({ status: "off", provider: null });
    expect(a.calls).toHaveLength(0);
  });
});

describe("gateway in mode off", () => {
  it("writes an off record and returns each fallback", async () => {
    const { gateway, store } = testGateway({ mode: "off" });
    const rule = await gateway.call<{ rule: { type: string } }>("compile_rule", payloads.compile_rule, ctx);
    expect(rule).toMatchObject({ ok: true, source: "fallback", value: { rule: { type: "range", sensor: "S03", max: 20 } } });
    const prose = await gateway.call<{ sentences: { text: string }[] }>("explain_diagnosis", payloads.explain_diagnosis, ctx);
    expect(prose.ok && prose.value.sentences.map((s) => s.text)[0]).toBe("Sensor fault: dead.");
    const plan = await gateway.call<{ calls: { tool: string }[] }>("plan_investigation", payloads.plan_investigation, ctx);
    expect(plan.ok && plan.value.calls.map((c) => c.tool)).toEqual(["find_changepoints", "rerun_without"]);
    const name = await gateway.call("name_role", payloads.name_role, ctx);
    expect(name).toEqual({ ok: false, recordId: "eg-004", reason: "no fallback for name_role, model off" });
    const search = await gateway.call("search", payloads.search, ctx);
    expect(search).toEqual({ ok: false, recordId: "eg-005", reason: "no fallback for search, model off" });
    expect(store.records).toHaveLength(5);
    for (const record of store.records) {
      expect(record).toMatchObject({ status: "off", mode: "off", provider: null, response: null });
      expect(record.guards.every((g) => g.pass)).toBe(true);
      expect(record.guards.map((g) => g.name)).toEqual(["schema", "floor", "size", "rounding", "leak", "names", "record"]);
    }
  });

  it("returns ok false with the fixed reason for a sentence the grammar does not know", async () => {
    const { gateway, store } = testGateway({ mode: "off" });
    const result = await gateway.call("compile_rule", compileRulePayload("please keep an eye on S03"), ctx);
    expect(result).toEqual({ ok: false, recordId: "eg-001", reason: "sentence not understood, model off" });
    expect(store.records[0]?.status).toBe("off");
  });

  it("still runs the guards and blocks a leak", async () => {
    const index = buildLeakIndex([{ alias: "S01", values: Float64Array.from([10, 20, 30]) }], []);
    const { gateway, store } = testGateway({ mode: "off", index });
    const result = await gateway.call("compile_rule", compileRulePayload("S03 read 10 20 30"), ctx);
    expect(result.ok).toBe(false);
    expect(store.records[0]?.status).toBe("blocked");
  });
});
