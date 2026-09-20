import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Provider } from "@tpm/egress";
import { ReviewReport, type DiagnosisInference } from "@tpm/schemas";
import { fixture, run, type Fixture } from "./fixture";

const runId = "0123abcd";
const evidenceIds = [`ev-${runId}-00001`];
const step = (index: number, test: DiagnosisInference["value"]["trace"][number]["test"], stats: Record<string, number>, result: string) => ({ index, test, name: test, n: 15000, stats, result, evidenceIds });
const diagnosis: DiagnosisInference = {
  runId,
  claim: "claim",
  confidence: 0.8,
  evidenceIds,
  status: "proposed",
  supersedes: null,
  id: `inf-${runId}-00009`,
  seq: 9,
  sensor: "S03",
  stage: "diagnosis",
  value: {
    faultClass: "sensor-drift-bias",
    window: { from: 5000, to: 20000, n: 15000 },
    onset: 5000,
    ranked: [{ sensor: "S03", contribution: 0.7, onset: 5000 }, { sensor: "S04", contribution: 0.3, onset: 5100 }],
    excluded: ["S09"],
    trace: [step(0, "isolation", { maxDeviation: 9.72, peers: 5 }, "S03 deviates up to 9.72 against 5 peers."), step(1, "verdict", { maxDeviation: 9.72 }, "Sensor fault: drift (bias). S03 leaves its peers.")],
    prose: null,
    pca: null,
  },
};
const verdict = (faultClass: string, summary: string) => JSON.stringify({ faultClass, confidence: 0.7, summary, concerns: ["Only 5 peers back the isolation step."] });

function reviewer(model: string, reply: () => Promise<string>): Provider & { payloads: string[] } {
  const payloads: string[] = [];
  return {
    name: "review",
    model,
    region: null,
    host: "review.local",
    payloads,
    async call(payloadText) {
      payloads.push(payloadText);
      return reply();
    },
  };
}

const primary: Provider = { name: "mock", model: "primary", region: null, host: "primary.local", call: async () => "{}" };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function settled(f: Fixture, id: string): Promise<ReviewReport> {
  for (;;) {
    const report = ReviewReport.parse(await (await f.app.request(`/api/inferences/${id}/reviews`)).json());
    if (report.pending === null) return report;
    await sleep(5);
  }
}

describe("cross review routes", () => {
  let f: Fixture;
  let release: () => void = () => {};
  const agree = reviewer("a/agree", async () => verdict("sensor-drift-bias", "S03 deviates up to 9.72 against 5 peers."));
  const slow = reviewer("b/slow", () => new Promise((resolve) => (release = () => resolve(verdict("process-degradation", "S03 and S04 move together, 5 peers.")))));
  const foreign = reviewer("c/foreign", async () => verdict("sensor-drift-gain", "S08 reads 12.5."));
  const broken = reviewer("d/broken", async () => "not json");

  beforeEach(() => {
    f = fixture({ resolveProvider: () => primary, resolveReviewers: () => [agree, slow, foreign, broken] });
    f.ctx.db.runs.save(run(runId));
    f.ctx.db.inferences.saveAll([diagnosis]);
    f.ctx.db.settings.set("model-mode", "cloud");
    agree.payloads.length = 0;
  });
  afterEach(() => f.close());

  it("runs the reviewers one after another, keeps the job visible, and reports each verdict against the engine", async () => {
    const started = await f.app.request(`/api/inferences/${diagnosis.id}/review`, { method: "POST" });
    expect(started.status).toBe(202);
    const first = ReviewReport.parse(await started.json());
    expect(first.pending).toMatchObject({ inferenceId: diagnosis.id, index: 0, total: 4 });
    await sleep(10);
    const second = await f.app.request(`/api/inferences/${diagnosis.id}/review`, { method: "POST" });
    expect(second.status).toBe(409);
    const during = ReviewReport.parse(await (await f.app.request(`/api/inferences/${diagnosis.id}/reviews`)).json());
    expect(during.pending?.model).toBe("b/slow");
    expect(during.reviews.map((r) => r.model)).toEqual(["b/slow", "a/agree"]);
    expect(during.reviews[0]).toMatchObject({ verdict: null, error: null });
    const successor: DiagnosisInference = { ...diagnosis, id: `inf-${runId}-00011`, seq: 11, supersedes: diagnosis.id };
    f.ctx.db.inferences.saveAll([{ ...diagnosis, status: "revised" }, successor]);
    const viaHead = ReviewReport.parse(await (await f.app.request(`/api/inferences/${diagnosis.id}/reviews`)).json());
    expect(viaHead.pending?.inferenceId).toBe(diagnosis.id);
    expect(viaHead.reviews.map((r) => r.inferenceId)).toEqual([diagnosis.id, diagnosis.id]);
    release();
    const report = await settled(f, diagnosis.id);
    expect(report.reviews.map((r) => [r.model, r.match, r.error === null, r.validator?.pass ?? null])).toEqual([
      ["d/broken", null, false, null],
      ["c/foreign", "family", true, false],
      ["b/slow", "none", true, true],
      ["a/agree", "class", true, true],
    ]);
    const withheld = report.reviews[1]!;
    expect(withheld.verdict).toMatchObject({ faultClass: "sensor-drift-gain", summary: "", concerns: [] });
    expect(withheld.validator?.errors).toEqual(["the summary names the unknown alias S08", "the summary has the number 12.5 that is not in the payload"]);
    expect(report.reviews[0]?.error).toBe("The reviewer call failed. Open the record for the reply.");
    const sent = JSON.parse(agree.payloads[0] ?? "") as { purpose: string; faultClass?: string; trace: { test: string }[] };
    expect(sent.purpose).toBe("cross_review");
    expect(sent.faultClass).toBeUndefined();
    expect(sent.trace.map((s) => s.test)).toEqual(["isolation"]);
    const records = f.ctx.db.egress.byInference(diagnosis.id, "cross_review");
    expect(records.map((r) => r.provider?.host)).toEqual(Array(4).fill("review.local"));
    expect(records.find((r) => r.provider?.model === "c/foreign")?.validator?.pass).toBe(false);
    const log = f.ctx.db.log.list(runId).map((row) => JSON.parse(row.text) as { type: string; egressId: string | null; after: { purpose?: string } | null });
    expect(log.filter((e) => e.type === "model-call" && e.after?.purpose === "cross_review")).toHaveLength(3);
    expect(log.filter((e) => e.type === "model-call" && e.after === null)).toHaveLength(1);
  });

  it("marks an interrupted call and hides text that no validator checked", async () => {
    const base = { runId, purpose: "cross_review" as const, mode: "cloud" as const, provider: { name: "review", model: "x/model", region: null, host: "review.local" }, payload: "{}", payloadBytes: 2, guards: [], templateHash: "t", inferenceId: diagnosis.id, operatorText: false, validator: null, durationMs: null };
    f.ctx.db.egress.save({ ...base, id: "eg-cut", time: "2026-09-20T10:00:00.000Z", status: "sent", response: null });
    f.ctx.db.egress.save({ ...base, id: "eg-raw", time: "2026-09-20T10:01:00.000Z", status: "sent", response: verdict("sensor-drift-bias", "S03 reads 9.72.") });
    const report = ReviewReport.parse(await (await f.app.request(`/api/inferences/${diagnosis.id}/reviews`)).json());
    expect(report.reviews.map((r) => [r.egressId, r.error, r.verdict?.summary ?? null])).toEqual([
      ["eg-raw", "The validator did not run.", ""],
      ["eg-cut", "The server restarted during the call.", null],
    ]);
  });

  it("refuses a review outside mode cloud and without reviewers", async () => {
    f.ctx.db.settings.set("model-mode", "off");
    expect((await f.app.request(`/api/inferences/${diagnosis.id}/review`, { method: "POST" })).status).toBe(400);
    f.ctx.db.settings.set("model-mode", "local");
    expect(await (await f.app.request(`/api/inferences/${diagnosis.id}/review`, { method: "POST" })).json()).toEqual({ error: "reviewers need mode cloud" });
    f.ctx.db.settings.set("model-mode", "cloud");
    const none = fixture({ resolveProvider: () => primary, resolveReviewers: () => [] });
    none.ctx.db.runs.save(run(runId));
    none.ctx.db.inferences.saveAll([diagnosis]);
    none.ctx.db.settings.set("model-mode", "cloud");
    expect(await (await none.app.request(`/api/inferences/${diagnosis.id}/review`, { method: "POST" })).json()).toEqual({ error: "no reviewer is set" });
    none.close();
  });
});
