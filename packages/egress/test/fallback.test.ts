import type { CompileRuleResponse, EgressPayload, PlanInvestigationResponse } from "@tpm/schemas";
import { describe, expect, it } from "vitest";
import { fallback, ruleSentenceForms } from "../src/index";
import { compileRulePayload, explainPayload, planPayload } from "./fixtures";

const rule = (sentence: string, dt: number | null = 180000) =>
  (fallback("compile_rule", compileRulePayload(sentence, dt)) as CompileRuleResponse | null)?.rule ?? null;

describe("compile_rule grammar with dt = 180000 ms", () => {
  it("parses each of the eight sentence forms", () => {
    const parsed = ruleSentenceForms.map((s) => rule(s));
    expect(parsed).toEqual([
      { type: "flatline", sensor: "S07", source: ruleSentenceForms[0], maxDuration: 4 },
      { type: "range", sensor: "S03", source: ruleSentenceForms[1], min: 10, max: 20 },
      { type: "range", sensor: "S03", source: ruleSentenceForms[2], max: 20 },
      { type: "range", sensor: "S03", source: ruleSentenceForms[3], min: 10 },
      { type: "rate", sensor: "S03", source: ruleSentenceForms[4], maxRate: 5 },
      { type: "relation", sensor: "S03", source: ruleSentenceForms[5], sensor2: "S04", relation: "tracks", tolerance: 2 },
      { type: "missing", sensor: "S03", source: ruleSentenceForms[6], maxMissingRate: 0.05, windowSize: 20 },
      { type: "aggregate", agg: "mean", sensor: "S03", source: ruleSentenceForms[7], windowSize: 20, max: 20 },
    ]);
  });

  it("converts durations with dt and rounds up to whole samples", () => {
    expect(rule("S07 must not stay flat for more than 1 hour")).toMatchObject({ maxDuration: 20 });
    expect(rule("S07 must not stay flat for more than 2 days")).toMatchObject({ maxDuration: 960 });
    expect(rule("S07 must not stay flat for more than 7 samples")).toMatchObject({ maxDuration: 7 });
    expect(rule("S07 must not stay flat for more than 1 minute")).toMatchObject({ maxDuration: 1 });
    expect(rule("S03 must not change faster than 3 per hour")).toMatchObject({ maxRate: 0.15 });
    expect(rule("S03 must not be missing more than 5% in 100 samples")).toMatchObject({ windowSize: 100 });
    expect(rule("S07 must not stay flat for more than 10 minutes", null)).toBeNull();
    expect(rule("S07 must not stay flat for more than 10 samples", null)).toMatchObject({ maxDuration: 10 });
  });

  it("accepts case and a final period, and returns null on gibberish", () => {
    expect(rule("s03 must stay ABOVE 10.")).toMatchObject({ type: "range", sensor: "S03", min: 10 });
    expect(rule("median of S03 over 30 minutes must stay between -1.5 and 2")).toMatchObject({
      agg: "median",
      windowSize: 10,
      min: -1.5,
      max: 2,
    });
    expect(rule("S03 must equal S04 within 0")).toMatchObject({ relation: "equals", tolerance: 0 });
    for (const bad of ["keep an eye on S03", "S03 must stay", "S03 must stay between 10", "the valve must not stick", ""]) {
      expect(rule(bad)).toBeNull();
    }
  });
});

describe("explain_diagnosis fallback", () => {
  it("writes the fault label first and one sentence per trace step with the evidence ids", () => {
    const value = fallback("explain_diagnosis", explainPayload) as { sentences: { text: string; evidenceIds: string[] }[] };
    expect(value.sentences.map((s) => s.text)).toEqual([
      "Sensor fault: dead.",
      "S05 failed the dead check with a run of 6400 identical samples against a limit of 40.",
      "S05 is excluded from the process diagnosis.",
    ]);
    expect(value.sentences[0]?.evidenceIds).toEqual(["ev-0123abcd-00001", "ev-0123abcd-00002"]);
    expect(fallback("explain_diagnosis", { ...explainPayload, trace: [] } as EgressPayload)).toBeNull();
  });
});

describe("plan_investigation fallback", () => {
  const plan = (stage: string, question?: string, sensor?: string | null, responsible?: string | null) =>
    (fallback("plan_investigation", planPayload(stage, question, sensor, responsible)) as PlanInvestigationResponse | null)?.calls ?? null;

  it("plans by stage", () => {
    expect(plan("role")).toEqual([
      { tool: "test_role", sensor: "S03", role: "controlled" },
      { tool: "compare_windows", sensor: "S03", a: { from: 0, to: 9000 }, b: { from: 9000, to: 20000 } },
    ]);
    expect(plan("drift")).toEqual([{ tool: "find_changepoints", sensor: "S03", near: 12000, span: 400 }]);
    expect(plan("drift", undefined, "S03", "S04")).toEqual([
      { tool: "find_changepoints", sensor: "S03", near: 12000, span: 400 },
      { tool: "rerun_without", sensor: "S04" },
    ]);
    expect(plan("diagnosis")).toEqual([
      { tool: "rerun_without", sensor: "S03" },
      { tool: "compare_windows", sensor: "S03", a: { from: 0, to: 9000 }, b: { from: 12000, to: 20000 } },
    ]);
    expect(plan("health")).toEqual([{ tool: "compare_windows", sensor: "S03", a: { from: 0, to: 9000 }, b: { from: 15000, to: 20000 } }]);
    expect(plan("baseline", "Is the baseline right?", null)).toEqual([{ tool: "find_changepoints", sensor: "S03", near: 9000, span: 400 }]);
    expect(plan("rule")).toBeNull();
  });

  it("centers find_changepoints on a sample, day or week named in the question", () => {
    const near = (stage: string, question: string) => (plan(stage, question, "S03")?.[0] as { near: number }).near;
    expect(near("drift", "did something change around sample 5000?")).toBe(5000);
    expect(near("drift", "I think the valve was replaced around day 21")).toBe(10080);
    expect(near("baseline", "something happened in week 3")).toBe(10080);
    expect(near("drift", "did 500 samples pass?")).toBe(500);
  });
});
