import { z } from "zod";
import { Alias, Window } from "./common.js";
import { ModelMode } from "./egress.js";
import { Evidence } from "./evidence.js";
import {
  BaselineInference,
  CalibrationInference,
  DiagnosisInference,
  DriftInference,
  HealthInference,
  Inference,
  OverrideValue,
  ThreadEntry,
} from "./inference.js";
import { Rule } from "./rule.js";
import { Run } from "./run.js";

export const FileEntry = z.object({ path: z.string(), name: z.string(), bytes: z.number(), modifiedAt: z.string() });
export type FileEntry = z.infer<typeof FileEntry>;
export const FileList = z.array(FileEntry);

export const CreateRunBody = z.object({ path: z.string().min(1) });
export const CreateRunResponse = z.object({ runId: z.string() });
export const RunList = z.array(Run);

export const QualityReport = z.object({
  runId: z.string(),
  baseline: BaselineInference,
  calibration: z.array(CalibrationInference),
  checks: z.array(HealthInference),
  rules: z.array(Rule),
});
export type QualityReport = z.infer<typeof QualityReport>;

export const DriftReport = z.object({ runId: z.string(), drifts: z.array(DriftInference) });
export type DriftReport = z.infer<typeof DriftReport>;

export const IncidentReport = z.object({ runId: z.string(), incidents: z.array(DiagnosisInference) });
export type IncidentReport = z.infer<typeof IncidentReport>;

export const QuestionBody = z.object({ text: z.string().min(1).max(500) });
export const OverrideBody = z.object({ value: OverrideValue, reason: z.string().min(1).max(500) });
export const ActionResponse = z.object({
  inference: Inference,
  thread: z.array(ThreadEntry),
  rerunId: z.string().nullable(),
  changed: z.array(z.object({ before: Inference, after: Inference })),
});
export type ActionResponse = z.infer<typeof ActionResponse>;

export const CompileRuleBody = z.object({ runId: z.string(), sentence: z.string().min(1).max(500) });
export const CompileRuleResult = z.object({ rule: Rule, egressId: z.string().nullable() });
export type CompileRuleResult = z.infer<typeof CompileRuleResult>;
export const ActivateRuleResponse = Rule;

export const ModelModeBody = z.object({ mode: ModelMode });

export const EvidenceQuery = z.object({ window: Window.optional(), sensors: z.array(Alias).optional() });

export const EvidenceList = z.array(Evidence);
