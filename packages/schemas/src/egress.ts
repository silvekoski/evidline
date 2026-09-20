import { z } from "zod";
import { Alias, Domain, FaultClass, HealthClass, InferenceStatus, Role, SignalType } from "./common.js";
import { InvestigationPlan, Stage, StatKey, TraceTest } from "./inference.js";
import { RuleJson } from "./rule.js";

export const Purpose = z.enum(["name_role", "check_name", "compile_rule", "explain_diagnosis", "plan_investigation", "search", "cross_review"]);
export type Purpose = z.infer<typeof Purpose>;

export const ModelMode = z.enum(["off", "local", "cloud"]);
export type ModelMode = z.infer<typeof ModelMode>;

export const ProviderInfo = z.object({ name: z.string(), model: z.string(), region: z.string().nullable(), host: z.string() });
export type ProviderInfo = z.infer<typeof ProviderInfo>;

export const ModelSettings = z.object({ mode: ModelMode, provider: ProviderInfo.nullable(), reviewers: z.array(ProviderInfo) });
export type ModelSettings = z.infer<typeof ModelSettings>;

const num = z.number().finite();
const count = z.number().int().min(100);
const shortArray = z.array(num).max(20);

export const PayloadWindow = z.object({ from: z.number().int().nonnegative(), to: z.number().int().nonnegative() }).strict();

export const SummaryQuantiles = z
  .object({ p1: num, p5: num, p25: num, p50: num, p75: num, p95: num, p99: num })
  .strict();

const PeerSummary = z.object({ alias: Alias, lag: z.number().int(), rho: num, n: count }).strict();

export const SensorSummary = z
  .object({
    alias: Alias,
    n: count,
    signalType: SignalType,
    missingRate: num,
    quantiles: SummaryQuantiles,
    mad: num,
    histogramShares: shortArray,
    noise: num,
    acfTime: num,
    period: num.nullable(),
    flatShare: num,
    monotonicShare: num,
    distinct: z.number().int(),
    hold: z.number().int(),
    role: Role,
    roleConfidence: num,
    leads: z.array(PeerSummary).max(20),
    follows: z.array(PeerSummary).max(20),
  })
  .strict();
export type SensorSummary = z.infer<typeof SensorSummary>;

export const RecordMetric = z.enum(["count", "nullRate", "formatViolationRate", "median", "p95", "roundShare", "zeroDigitShare", "share", "otherShare", "distinct", "duplicateRate"]);
export type RecordMetric = z.infer<typeof RecordMetric>;

export function recordMetric(sourceName: string): RecordMetric | null {
  const parsed = RecordMetric.safeParse(sourceName.replace(/\[.*$/, "").split(".").at(-1));
  return parsed.success ? parsed.data : null;
}

const nameFields = { dt: num.nullable(), domain: Domain, metric: RecordMetric.nullable(), sensor: SensorSummary };
export const NameRolePayload = z.object({ purpose: z.literal("name_role"), ...nameFields }).strict();
export const CheckNamePayload = z.object({ purpose: z.literal("check_name"), ...nameFields }).strict();

export const CatalogEntry = z.object({ alias: Alias, signalType: SignalType, role: Role }).strict();

export const CompileRulePayload = z
  .object({
    purpose: z.literal("compile_rule"),
    sentence: z.string().max(500),
    dt: num.nullable(),
    n: count,
    catalog: z.array(CatalogEntry).max(20),
  })
  .strict();

const PayloadTraceStep = z
  .object({
    index: z.number().int(),
    test: TraceTest,
    name: z.string().max(60),
    n: count,
    stats: z.record(StatKey, num).refine((o) => Object.keys(o).length <= 20, "at most 20 stats"),
    result: z.string().max(300),
    evidenceIds: z.array(z.string().regex(/^ev-[0-9a-f]{8}-\d{5}$/)).min(1).max(20),
  })
  .strict();

const diagnosisFields = {
  n: count,
  onset: z.number().int().nullable(),
  ranked: z.array(z.object({ alias: Alias, contribution: num }).strict()).max(20),
  excluded: z.array(Alias).max(20),
  trace: z.array(PayloadTraceStep).max(20),
};

export const ExplainDiagnosisPayload = z.object({ purpose: z.literal("explain_diagnosis"), faultClass: FaultClass, ...diagnosisFields }).strict();

export const CrossReviewPayload = z.object({ purpose: z.literal("cross_review"), ...diagnosisFields }).strict();
export type CrossReviewPayload = z.infer<typeof CrossReviewPayload>;

export const PlanInvestigationPayload = z
  .object({
    purpose: z.literal("plan_investigation"),
    question: z.string().max(500),
    dt: num.nullable(),
    n: count,
    inference: z
      .object({
        stage: z.string().max(20),
        claim: z.string().max(300),
        sensor: Alias.nullable(),
        onset: z.number().int().nullable(),
        responsible: Alias.nullable(),
        baseline: PayloadWindow,
        masked: z.array(PayloadWindow).max(20),
      })
      .strict(),
    catalog: z.array(CatalogEntry).max(20),
    tools: z.array(z.string().max(40)).max(20),
  })
  .strict();

export const SearchPayload = z.object({ purpose: z.literal("search"), query: z.string().min(1).max(200), domain: Domain }).strict();

export const EgressPayload = z.discriminatedUnion("purpose", [
  NameRolePayload,
  CheckNamePayload,
  CompileRulePayload,
  ExplainDiagnosisPayload,
  PlanInvestigationPayload,
  SearchPayload,
  CrossReviewPayload,
]);
export type EgressPayload = z.infer<typeof EgressPayload>;

export const NameRoleResponse = z
  .object({ name: z.string().max(60), quantity: z.string().max(40), confidence: z.number().min(0).max(1), reason: z.string().max(200) })
  .strict();
export type NameRoleResponse = z.infer<typeof NameRoleResponse>;
const clipped = (max: number) => z.string().transform((s) => (s.length > max ? `${s.slice(0, max - 1)}…` : s));
export const CheckNameResponse = z.object({ name: clipped(60), quantity: clipped(40), confidence: z.number().min(0).max(1), reason: clipped(200) });
export type CheckNameResponse = z.infer<typeof CheckNameResponse>;
export const CompileRuleResponse = z.object({ rule: RuleJson }).strict();
export type CompileRuleResponse = z.infer<typeof CompileRuleResponse>;
export const ExplainDiagnosisResponse = z
  .object({ sentences: z.array(z.object({ text: z.string().max(300), evidenceIds: z.array(z.string()).min(1) }).strict()).min(1).max(12) })
  .strict();
export type ExplainDiagnosisResponse = z.infer<typeof ExplainDiagnosisResponse>;
export const PlanInvestigationResponse = InvestigationPlan;
export type PlanInvestigationResponse = z.infer<typeof PlanInvestigationResponse>;
export const CrossReviewResponse = z
  .object({
    faultClass: FaultClass,
    confidence: z.number().min(0).max(1),
    summary: z.string().max(300),
    concerns: z.array(z.string().max(200)).max(3),
  })
  .strict();
export type CrossReviewResponse = z.infer<typeof CrossReviewResponse>;

export const SearchFamily = z.enum(["sensor", "process", "data"]);
export const SearchDrift = z.enum(["drifting", "responsible", "victim", "in-range"]);
export const SearchConfidence = z.enum(["low", "high"]);
const facet = <F extends string, V extends z.ZodType>(field: F, value: V) => z.object({ field: z.literal(field), value }).strict();
export const SearchFacet = z.discriminatedUnion("field", [
  facet("kind", z.enum(["sensor", "inference"])),
  facet("sensor", Alias),
  facet("role", Role),
  facet("signalType", SignalType),
  facet("health", z.union([z.literal("healthy"), HealthClass])),
  facet("stage", Stage),
  facet("family", SearchFamily),
  facet("faultClass", FaultClass),
  facet("status", InferenceStatus),
  facet("drift", SearchDrift),
  facet("confidence", SearchConfidence),
  facet("text", z.string().min(1).max(40)),
]);
export type SearchFacet = z.infer<typeof SearchFacet>;
export const SearchQuery = z.object({ clauses: z.array(z.array(SearchFacet).min(1).max(8)).max(8) }).strict();
export type SearchQuery = z.infer<typeof SearchQuery>;
export const SearchResponse = SearchQuery;
export type SearchResponse = z.infer<typeof SearchResponse>;

export const GuardName = z.enum(["schema", "floor", "size", "rounding", "leak", "names", "record"]);
export type GuardName = z.infer<typeof GuardName>;

export const GuardResult = z.object({ name: GuardName, pass: z.boolean(), detail: z.string(), hits: z.number().int().optional() });
export type GuardResult = z.infer<typeof GuardResult>;

export const EgressRecord = z.object({
  id: z.string(),
  runId: z.string().nullable(),
  time: z.string(),
  purpose: Purpose,
  mode: ModelMode,
  provider: ProviderInfo.nullable(),
  payload: z.string(),
  payloadBytes: z.number().int(),
  guards: z.array(GuardResult),
  templateHash: z.string(),
  inferenceId: z.string().nullable(),
  operatorText: z.boolean(),
  status: z.enum(["sent", "blocked", "off", "error"]),
  response: z.string().nullable(),
  validator: z.object({ pass: z.boolean(), errors: z.array(z.string()) }).nullable(),
  durationMs: z.number().nullable(),
});
export type EgressRecord = z.infer<typeof EgressRecord>;

export const EgressTotals = z.object({
  rawBytes: z.number(),
  sentBytes: z.number(),
  calls: z.number().int(),
  sent: z.number().int(),
  blocked: z.number().int(),
  off: z.number().int(),
  scannerHits: z.number().int(),
  hosts: z.array(z.string()),
});
export type EgressTotals = z.infer<typeof EgressTotals>;

const Template = z.object({ text: z.string(), hash: z.string() });
export const TemplateInfo = z.record(Purpose, Template);
export type TemplateInfo = z.infer<typeof TemplateInfo>;

export const TemplateName = z.enum([...Purpose.options, "extract"]);
export type TemplateName = z.infer<typeof TemplateName>;
export const TemplateCatalog = z.record(TemplateName, Template);
export type TemplateCatalog = z.infer<typeof TemplateCatalog>;

export const ReviewMatch = z.enum(["class", "family", "none"]);
export type ReviewMatch = z.infer<typeof ReviewMatch>;

export const Review = z.object({
  egressId: z.string(),
  inferenceId: z.string(),
  time: z.string(),
  model: z.string(),
  host: z.string(),
  verdict: CrossReviewResponse.nullable(),
  match: ReviewMatch.nullable(),
  validator: z.object({ pass: z.boolean(), errors: z.array(z.string()) }).nullable(),
  error: z.string().nullable(),
});
export type Review = z.infer<typeof Review>;

export const ReviewJob = z.object({ inferenceId: z.string(), model: z.string(), index: z.number().int(), total: z.number().int() });
export type ReviewJob = z.infer<typeof ReviewJob>;

export const ReviewReport = z.object({ pending: ReviewJob.nullable(), reviews: z.array(Review) });
export type ReviewReport = z.infer<typeof ReviewReport>;

export const NameCheck = z.object({
  egressId: z.string(),
  time: z.string(),
  model: z.string(),
  host: z.string(),
  name: z.string().nullable(),
  quantity: z.string().nullable(),
  confidence: z.number().nullable(),
  reason: z.string().nullable(),
  agrees: z.boolean().nullable(),
  error: z.string().nullable(),
});
export type NameCheck = z.infer<typeof NameCheck>;
export const PrimaryName = NameCheck.omit({ agrees: true, error: true });
export type PrimaryName = z.infer<typeof PrimaryName>;
export const NameCheckJob = z.object({ runId: z.string(), done: z.number().int(), total: z.number().int(), model: z.string() });
export type NameCheckJob = z.infer<typeof NameCheckJob>;
export const NameCheckReport = z.object({ pending: NameCheckJob.nullable(), primary: PrimaryName.nullable(), checks: z.array(NameCheck) });
export type NameCheckReport = z.infer<typeof NameCheckReport>;
