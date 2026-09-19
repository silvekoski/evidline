import { createHash } from "node:crypto";
import type { ZodType } from "zod";
import {
  CompileRuleResponse,
  ExplainDiagnosisResponse,
  FaultClass,
  HealthClass,
  InferenceStatus,
  NameRoleResponse,
  PlanInvestigationResponse,
  Role,
  SearchResponse,
  SignalType,
  Stage,
  faultLabel,
  type Purpose,
  type TemplateInfo,
} from "@tpm/schemas";

const format = ["Aliases have the form S01. They are opaque.", "Reply with one JSON object and nothing else. Do not add fields."];

const units = [
  "Units: every window, onset, lag, span, duration and window size is in grid samples, from 0 to n.",
  "When dt is not null, one grid sample is dt milliseconds. When dt is null, no time unit exists.",
  ...format,
].join("\n");

const list = (values: readonly string[]) => values.join(", ");

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
    "Use only aliases from the catalog.",
    "A duration in the sentence converts to samples: samples = ceil(duration in milliseconds / dt).",
    "Worked example: dt = 180000 and a duration of 10 minutes = 600000 ms give ceil(600000 / 180000) = 4 samples.",
    "One minute is 60000 ms, one hour is 3600000 ms, one day is 86400000 ms.",
    "When dt is null, read a duration as samples. maxRate is sensor units per sample: divide a rate per hour by the samples per hour.",
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
    "Each sentence cites the evidenceIds of its step in the evidenceIds field only. Never write an evidence id inside the text.",
    "The first sentence cites the evidenceIds of the verdict step.",
    "Use only numbers that appear in the stats of the cited step, with at most 3 significant digits.",
    "Use only aliases that appear in the payload. Do not add a cause, a number or a sensor that the trace does not contain.",
    `Fault labels: ${faultLabels}.`,
    units,
    "Response schema: { sentences: [ { text (string, at most 300 characters), evidenceIds (array of strings, at least 1) } ] }",
    "with 1 to 12 sentences.",
  ].join("\n"),
  plan_investigation: [
    "You plan an investigation for one operator question about one inference.",
    "You get a JSON object: question, dt, n, inference (stage, claim, sensor, onset, responsible sensor, baseline window, masked windows),",
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
  search: [
    "You compile one operator search query into a filter over the sensors and the inferences of one run.",
    "You get a JSON object: query (the operator text) and domain (stream for a sensor stream, records for business records, where a field is a sensor).",
    "A filter is a list of clauses. An item matches the filter when it matches every clause. An item matches a clause when it matches any facet in the clause.",
    "Put alternatives in one clause. Put each further condition in its own clause.",
    'Worked example: "dead or stuck sensors" is { clauses: [ [ { field: health, value: dead }, { field: health, value: stuck } ], [ { field: kind, value: sensor } ] ] }.',
    "Do not put kind in a clause with other facets: [ kind sensor, health dead ] matches every sensor.",
    "A facet has a field and a value. Fields: kind (sensor or inference), sensor (an alias), role, signalType, health, stage,",
    "family (sensor, process or data, the fault family of a diagnosis), faultClass, status, drift (drifting, responsible, victim or in-range),",
    "confidence (low or high), text (one word to find in sensor names and claims).",
    `role: ${list(Role.options)}. signalType: ${list(SignalType.options)}. health: healthy, ${list(HealthClass.options)}.`,
    `stage: ${list(Stage.options)}. status: ${list(InferenceStatus.options)}. faultClass: ${list(FaultClass.options)}.`,
    "A word for a physical quantity or an equipment, for example pressure or valve, is a text facet. A word with no facet is a text facet.",
    "A sensor that stopped, reports nothing or is flat is health dropout, dead or stuck. A sensor that causes a drift is drift responsible.",
    "Add only facets that the query asks for. Use at most 8 clauses with at most 8 facets each. An empty clause list matches everything.",
    ...format,
    "Response schema: { clauses: [ [ { field, value } ] ] }.",
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
  search: SearchResponse,
};
