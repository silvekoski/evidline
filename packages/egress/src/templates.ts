import { createHash } from "node:crypto";
import type { ZodType } from "zod";
import {
  CompileRuleResponse,
  ExplainDiagnosisResponse,
  FaultClass,
  NameRoleResponse,
  PlanInvestigationResponse,
  faultLabel,
  type Purpose,
  type TemplateInfo,
} from "@tpm/schemas";

const units = [
  "Units: every window, onset, lag, span, duration and window size is in grid samples, from 0 to n.",
  "When dt is not null, one grid sample is dt milliseconds. When dt is null, no time unit exists.",
  "Aliases have the form S01. They are opaque.",
  "Reply with one JSON object and nothing else. Do not add fields.",
].join("\n");

const faultLabels = FaultClass.options.map((fc) => `${fc} = ${faultLabel(fc)}`).join(", ");

const text: Record<Purpose, string> = {
  name_role: [
    "You propose a physical quantity for one sensor of an industrial process.",
    "You get a JSON summary of one sensor: alias, n, signal type, missing rate, quantiles p1 to p99, MAD,",
    "histogram shares, noise, acfTime, period, flat share, monotonic share, distinct values, hold,",
    "the role from the engine with its confidence, and the peers it leads and follows with lag, rho and n.",
    "The role and the relations are facts from the engine. Your answer is a hypothesis.",
    units,
    "Response schema: name (string, at most 60 characters, a physical quantity or an equipment reading),",
    "quantity (string, at most 40 characters, the kind of quantity or its usual unit),",
    "confidence (number from 0 to 1), reason (string, at most 200 characters).",
  ].join("\n"),
  compile_rule: [
    "You compile one operator sentence into one monitoring rule.",
    "You get a JSON object: sentence, dt, n, and a catalog of sensors with alias, signal type and role.",
    "Use only aliases from the catalog. Convert minutes, hours and days to samples with dt and round up to a whole sample.",
    "When dt is null, read a duration as samples. maxRate is sensor units per sample.",
    units,
    "Response schema: { rule }. Every rule has type, sensor (alias) and source (the sentence verbatim).",
    "Types: range with min and/or max. flatline with maxDuration (samples, positive integer).",
    "rate with maxRate (positive). relation with sensor2 (alias), relation (tracks, leads or equals),",
    "tolerance (0 or more) and optional lag (samples). missing with maxMissingRate (0 to 1) and windowSize (samples).",
    "aggregate with agg (mean, median, min, max or std), windowSize (samples) and min and/or max.",
  ].join("\n"),
  explain_diagnosis: [
    "You rewrite the reasoning trace of one fault diagnosis as short prose for an operator.",
    "You get a JSON object: faultClass, n, onset, ranked sensors with contributions, excluded sensors,",
    "and trace steps. Each step has index, test, name, n, stats, result and evidenceIds.",
    "Write one first sentence that states the fault label, then one sentence per trace step in order.",
    "Each sentence cites the evidenceIds of its step. The first sentence cites the evidenceIds of the verdict step.",
    "Use only numbers that appear in the stats of the cited step, with at most 3 significant digits.",
    "Use only aliases that appear in the payload. Do not add a cause, a number or a sensor that the trace does not contain.",
    `Fault labels: ${faultLabels}.`,
    units,
    "Response schema: { sentences: [ { text (string, at most 300 characters), evidenceIds (array of strings, at least 1) } ] }",
    "with 1 to 12 sentences.",
  ].join("\n"),
  plan_investigation: [
    "You plan an investigation for one operator question about one inference.",
    "You get a JSON object: question, dt, n, inference (stage, claim, sensor, onset, baseline window, masked windows),",
    "a catalog of sensors with alias, signal type and role, and the list of tool names.",
    "Use only aliases from the catalog and only tools from the list. Pick 1 to 4 tool calls that test the question.",
    units,
    "Response schema: { calls: [tool calls], rationale (string, at most 300 characters) }.",
    "Tool calls: { tool: compare_windows, sensor, a: { from, to }, b: { from, to } }.",
    "{ tool: test_relation, a, b, window: { from, to } }. { tool: find_changepoints, sensor, near, span }.",
    "{ tool: rerun_without, sensor }. { tool: test_role, sensor, role }, role is one of setpoint, controlled, actuator,",
    "redundant, upstream, downstream, counter, state, unknown. { tool: check_rule, rule, window: { from, to } },",
    "rule is a rule object as in a compile_rule response.",
  ].join("\n"),
};

const info = Object.fromEntries(
  Object.entries(text).map(([purpose, t]) => [purpose, { text: t, hash: createHash("sha256").update(t).digest("hex") }]),
) as TemplateInfo;

export const templates: (() => TemplateInfo) & Record<Purpose, string> = Object.assign(() => info, text);

export const responseSchema: Record<Purpose, ZodType> = {
  name_role: NameRoleResponse,
  compile_rule: CompileRuleResponse,
  explain_diagnosis: ExplainDiagnosisResponse,
  plan_investigation: PlanInvestigationResponse,
};
