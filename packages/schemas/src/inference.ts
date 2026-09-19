import { z } from "zod";
import { Alias, FaultClass, HealthClass, InferenceStatus, Role, Window } from "./common.js";
import { RuleJson } from "./rule.js";

export const Stage = z.enum(["baseline", "health", "role", "drift", "diagnosis", "rule", "calibration"]);
export type Stage = z.infer<typeof Stage>;

export const TraceTest = z.enum(["health", "drift", "isolation", "propagation", "control-loop", "verdict"]);
export type TraceTest = z.infer<typeof TraceTest>;

export const StatKey = z.string().regex(/^[a-zA-Z0-9_]{1,32}$/);

export const TraceStep = z
  .object({
    index: z.number().int(),
    test: TraceTest,
    name: z.string().max(60),
    n: z.number().int().nonnegative(),
    stats: z.record(StatKey, z.number()).refine((o) => Object.keys(o).length <= 20, "at most 20 stats"),
    result: z.string().max(300),
    evidenceIds: z.array(z.string()).min(1).max(20),
  })
  .strict();
export type TraceStep = z.infer<typeof TraceStep>;

export const BaselineValue = z.object({ window: Window, changepoints: z.array(z.number().int()) });
export type BaselineValue = z.infer<typeof BaselineValue>;

export const HealthValue = z.object({
  sensor: Alias,
  health: z.union([z.literal("healthy"), HealthClass]),
  masked: z.array(Window),
  checks: z.array(z.object({ check: HealthClass, pass: z.boolean(), statistic: z.number(), threshold: z.number() })),
});
export type HealthValue = z.infer<typeof HealthValue>;

export const RoleValue = z.object({
  sensor: Alias,
  role: Role,
  scores: z.record(Role, z.number()),
  hypothesisName: z.string().nullable(),
  hypothesisConfidence: z.number().nullable(),
});
export type RoleValue = z.infer<typeof RoleValue>;

export const DriftValue = z.object({
  sensor: Alias,
  method: z.enum(["peer-residual", "distribution"]),
  peers: z.array(Alias),
  onset: z.number().int().nullable(),
  ratePer1000: z.number(),
  mannKendallZ: z.number(),
  pValue: z.number(),
  severity: z.number(),
  maxDeviation: z.number(),
  inRange: z.boolean(),
  responsible: Alias.nullable(),
  detectionDelay: z.number().int().nullable(),
});
export type DriftValue = z.infer<typeof DriftValue>;

export const RankedSensor = z.object({ sensor: Alias, contribution: z.number(), onset: z.number().int().nullable() });
export type RankedSensor = z.infer<typeof RankedSensor>;

export const ProseValidation = z.object({
  pass: z.boolean(),
  errors: z.array(z.string()),
  sentences: z.array(z.object({ text: z.string(), evidenceIds: z.array(z.string()) })),
});
export type ProseValidation = z.infer<typeof ProseValidation>;

export const DiagnosisValue = z.object({
  faultClass: FaultClass,
  window: Window,
  onset: z.number().int().nullable(),
  ranked: z.array(RankedSensor),
  excluded: z.array(Alias),
  trace: z.array(TraceStep),
  prose: z.object({ text: z.string(), source: z.enum(["model", "template"]), validation: ProseValidation }).nullable(),
  pca: z.object({ t2: z.number(), t2Limit: z.number(), spe: z.number(), speLimit: z.number() }).nullable(),
});
export type DiagnosisValue = z.infer<typeof DiagnosisValue>;

export const RuleValue = z.object({ rule: RuleJson, restated: z.string(), violations: z.number().int(), active: z.boolean() });
export type RuleValue = z.infer<typeof RuleValue>;

export const Thresholds = z.object({
  cusumH: z.number(),
  cusumK: z.number(),
  deviationLimit: z.number(),
  distributionLimit: z.number(),
  deadRunFactor: z.number(),
  stuckNoiseRatio: z.number(),
  spikeSigma: z.number(),
  noisyRatio: z.number(),
  dropoutRateFactor: z.number(),
  saturationShare: z.number(),
  redundancyRho: z.number(),
  relationRho: z.number(),
});
export type Thresholds = z.infer<typeof Thresholds>;

export const CalibrationValue = z.object({
  thresholds: Thresholds,
  falseAlarmRate: z.number(),
  targetFalseAlarmRate: z.number(),
  detection: z.array(
    z.object({ fault: z.string(), magnitude: z.number(), detected: z.boolean(), delay: z.number().int().nullable() }),
  ),
});
export type CalibrationValue = z.infer<typeof CalibrationValue>;

const inferenceBase = {
  id: z.string(),
  runId: z.string(),
  sensor: Alias.nullable(),
  claim: z.string(),
  confidence: z.number().min(0).max(1),
  evidenceIds: z.array(z.string()).min(1),
  status: InferenceStatus,
  supersedes: z.string().nullable(),
  seq: z.number().int(),
};

export const BaselineInference = z.object({ ...inferenceBase, stage: z.literal("baseline"), value: BaselineValue });
export const HealthInference = z.object({ ...inferenceBase, stage: z.literal("health"), value: HealthValue });
export const RoleInference = z.object({ ...inferenceBase, stage: z.literal("role"), value: RoleValue });
export const DriftInference = z.object({ ...inferenceBase, stage: z.literal("drift"), value: DriftValue });
export const DiagnosisInference = z.object({ ...inferenceBase, stage: z.literal("diagnosis"), value: DiagnosisValue });
export const RuleInference = z.object({ ...inferenceBase, stage: z.literal("rule"), value: RuleValue });
export const CalibrationInference = z.object({ ...inferenceBase, stage: z.literal("calibration"), value: CalibrationValue });

export const Inference = z.discriminatedUnion("stage", [
  BaselineInference,
  HealthInference,
  RoleInference,
  DriftInference,
  DiagnosisInference,
  RuleInference,
  CalibrationInference,
]);
export type Inference = z.infer<typeof Inference>;
export type BaselineInference = z.infer<typeof BaselineInference>;
export type HealthInference = z.infer<typeof HealthInference>;
export type RoleInference = z.infer<typeof RoleInference>;
export type DriftInference = z.infer<typeof DriftInference>;
export type DiagnosisInference = z.infer<typeof DiagnosisInference>;
export type RuleInference = z.infer<typeof RuleInference>;
export type CalibrationInference = z.infer<typeof CalibrationInference>;
export type InferenceValue = Inference["value"];

export const OverrideValue = z.union([
  z.object({ kind: z.literal("role"), role: Role }),
  z.object({ kind: z.literal("faultClass"), faultClass: FaultClass }),
  z.object({ kind: z.literal("baseline"), window: Window }),
  z.object({ kind: z.literal("responsible"), sensor: Alias }),
]);
export type OverrideValue = z.infer<typeof OverrideValue>;

export const Overrides = z.object({
  baseline: Window.optional(),
  roles: z.record(z.string(), Role).optional(),
  masked: z.array(Alias).optional(),
  faultClass: z.record(z.string(), FaultClass).optional(),
  responsible: z.record(z.string(), Alias).optional(),
});
export type Overrides = z.infer<typeof Overrides>;

export const WindowArg = z.object({ from: z.number().int().nonnegative(), to: z.number().int().positive() }).strict();
export type WindowArg = z.infer<typeof WindowArg>;

export const InvestigationTool = z.enum([
  "compare_windows",
  "test_relation",
  "find_changepoints",
  "rerun_without",
  "test_role",
  "check_rule",
]);
export type InvestigationTool = z.infer<typeof InvestigationTool>;

export const ToolCall = z.discriminatedUnion("tool", [
  z.object({ tool: z.literal("compare_windows"), sensor: Alias, a: WindowArg, b: WindowArg }).strict(),
  z.object({ tool: z.literal("test_relation"), a: Alias, b: Alias, window: WindowArg }).strict(),
  z.object({ tool: z.literal("find_changepoints"), sensor: Alias, near: z.number().int(), span: z.number().int() }).strict(),
  z.object({ tool: z.literal("rerun_without"), sensor: Alias }).strict(),
  z.object({ tool: z.literal("test_role"), sensor: Alias, role: Role }).strict(),
  z.object({ tool: z.literal("check_rule"), rule: RuleJson, window: WindowArg }).strict(),
]);
export type ToolCall = z.infer<typeof ToolCall>;

export const InvestigationPlan = z.object({ calls: z.array(ToolCall).min(1).max(4), rationale: z.string().max(300) });
export type InvestigationPlan = z.infer<typeof InvestigationPlan>;

export const ThreadEntry = z.object({
  id: z.string(),
  inferenceId: z.string(),
  time: z.string(),
  kind: z.enum(["question", "plan", "result", "verdict", "override", "accept"]),
  text: z.string(),
  evidenceIds: z.array(z.string()),
  egressId: z.string().nullable(),
});
export type ThreadEntry = z.infer<typeof ThreadEntry>;
