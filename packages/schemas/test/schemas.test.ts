import { describe, expect, it } from "vitest";
import { ExplainDiagnosisPayload, Fingerprint, Inference, RoleValue, RuleJson, recordMetric } from "../src/index";

const fp = {
  n: 1000,
  missingRate: 0,
  quantiles: { p1: 0, p5: 0, p25: 0, p50: 0, p75: 0, p95: 0, p99: 0 },
  mad: 1,
  histogram: { edges: Array.from({ length: 21 }, (_, i) => i), shares: Array.from({ length: 20 }, () => 0.05) },
  step: 0.1,
  hold: 1,
  noise: 0.1,
  acfTime: 3,
  period: null,
  flatShare: 0,
  monotonicShare: 0,
  distinct: 100,
  signalType: "fast",
};

describe("schemas", () => {
  it("accepts 20 histogram bins and rejects 21", () => {
    expect(Fingerprint.safeParse(fp).success).toBe(true);
    const bad = { ...fp, histogram: { edges: Array.from({ length: 22 }, (_, i) => i), shares: Array.from({ length: 21 }, () => 0.05) } };
    expect(Fingerprint.safeParse(bad).success).toBe(false);
  });

  it("requires all nine role scores", () => {
    const scores = { setpoint: 0, controlled: 0, actuator: 0, redundant: 0, upstream: 0, downstream: 0, counter: 0, state: 0, unknown: 0 };
    expect(RoleValue.safeParse({ sensor: "S01", role: "unknown", scores, hypothesisName: null, hypothesisConfidence: null }).success).toBe(true);
    const { unknown: _u, ...partial } = scores;
    expect(RoleValue.safeParse({ sensor: "S01", role: "unknown", scores: partial, hypothesisName: null, hypothesisConfidence: null }).success).toBe(false);
  });

  it("rejects an unknown key at every level of the explain payload", () => {
    const step = { index: 0, test: "health", name: "Health", n: 500, stats: { runLength: 3 }, result: "ok", evidenceIds: ["ev-0123abcd-00001"] };
    const payload = { purpose: "explain_diagnosis", faultClass: "sensor-dead", n: 500, onset: 10, ranked: [{ alias: "S01", contribution: 1 }], excluded: [], trace: [step] };
    expect(ExplainDiagnosisPayload.safeParse(payload).success).toBe(true);
    expect(ExplainDiagnosisPayload.safeParse({ ...payload, sourceName: "x" }).success).toBe(false);
    expect(ExplainDiagnosisPayload.safeParse({ ...payload, trace: [{ ...step, t0: "2026-01-01" }] }).success).toBe(false);
    expect(ExplainDiagnosisPayload.safeParse({ ...payload, ranked: [{ alias: "S01", contribution: 1, header: "x" }] }).success).toBe(false);
  });

  it("discriminates inferences by stage", () => {
    const r = Inference.safeParse({
      id: "inf-1", runId: "0123abcd", stage: "drift", sensor: "S01", claim: "c", confidence: 0.5, evidenceIds: ["ev-0123abcd-00001"], status: "proposed", supersedes: null, seq: 1,
      value: { sensor: "S01", role: "unknown", scores: {}, hypothesisName: null, hypothesisConfidence: null },
    });
    expect(r.success).toBe(false);
  });

  it("reads the record metric from a source name without the column", () => {
    expect(recordMetric("rows.count")).toBe("count");
    expect(recordMetric("UnitPrice.median[Country=UK]")).toBe("median");
    expect(recordMetric("Country.share[UK]")).toBe("share");
    expect(recordMetric("reactor_pressure")).toBeNull();
    expect(recordMetric("median.temperature")).toBeNull();
  });

  it("rejects a range rule without bounds", () => {
    expect(RuleJson.safeParse({ type: "range", sensor: "S01", source: "s" }).success).toBe(false);
    expect(RuleJson.safeParse({ type: "range", sensor: "S01", source: "s", max: 3 }).success).toBe(true);
  });
});
