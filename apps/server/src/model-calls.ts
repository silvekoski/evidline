import { fallback, validateProse } from "@tpm/egress";
import { faultLabel, type DiagnosisInference, type ExplainDiagnosisResponse, type Inference, type InferenceStatus, type NameRoleResponse, type RoleInference } from "@tpm/schemas";
import type { AppContext } from "./context";
import { appendLog } from "./log";
import { createInference, type InferenceDraft } from "./persist";
import { explanationPayload, sensorSummary } from "./payloads";

const inFlight = new Set<string>();

function supersede(ctx: AppContext, old: Inference, value: Inference["value"], recordId: string | null, reason: string, keep: (status: InferenceStatus) => boolean): void {
  ctx.db.transaction(() => {
    const current = ctx.db.inferences.get(old.id);
    if (!current || current.status === "revised" || !keep(current.status)) return;
    ctx.db.inferences.save({ ...current, status: "revised" });
    const created = createInference(ctx.db, { ...current, value, supersedes: current.id } as InferenceDraft);
    appendLog(ctx.db, { type: "inference", actor: "agent", runId: current.runId, inferenceId: created.id, evidenceIds: created.evidenceIds, egressId: recordId, before: current.value, after: value, reason });
  });
}

async function explain(ctx: AppContext, inference: DiagnosisInference): Promise<void> {
  const payload = explanationPayload(inference);
  const result = await ctx.gateway.call<ExplainDiagnosisResponse>("explain_diagnosis", payload, { runId: inference.runId, inferenceId: inference.id, operatorText: false });
  const validationContext = { evidence: ctx.db.evidence.list(inference.runId), aliases: ctx.db.sensors.list(inference.runId).map((s) => s.alias), faultClass: inference.value.faultClass };
  const modelValidation = result.ok ? validateProse(result.value.sentences, validationContext) : null;
  if (result.recordId) {
    const record = ctx.db.egress.get(result.recordId);
    if (record && modelValidation) ctx.db.egress.save({ ...record, validator: { pass: modelValidation.pass, errors: modelValidation.errors } });
  }
  const source: "model" | "template" = result.ok && result.source === "model" && modelValidation?.pass ? "model" : "template";
  let validation = modelValidation;
  if (source === "template") {
    const template = fallback("explain_diagnosis", payload) as ExplainDiagnosisResponse | null;
    validation = validateProse(template?.sentences ?? [{ text: `${faultLabel(inference.value.faultClass)}.`, evidenceIds: inference.evidenceIds }], validationContext);
    if (!validation.pass) validation = validateProse([{ text: `${faultLabel(inference.value.faultClass)}.`, evidenceIds: inference.evidenceIds }], validationContext);
  }
  if (!validation) return;
  const prose = { text: validation.sentences.map((s) => s.text).join(" "), source, validation };
  appendLog(ctx.db, { type: "model-call", actor: "agent", runId: inference.runId, inferenceId: inference.id, evidenceIds: inference.evidenceIds, egressId: result.recordId, before: null, after: { purpose: "explain_diagnosis", source, validator: modelValidation }, reason: result.ok ? null : result.reason });
  supersede(ctx, inference, { ...inference.value, prose }, result.recordId, `Diagnosis explanation (${source})`, () => true);
}

export async function runModelCalls(ctx: AppContext, runId: string): Promise<boolean> {
  if (inFlight.has(runId)) return false;
  inFlight.add(runId);
  try {
    const run = ctx.db.runs.get(runId);
    if (!run) throw new Error(`Unknown run ${runId}`);
    const inferences = ctx.db.inferences.list(runId).filter((i) => i.status !== "revised");
    const roles = inferences.filter((i): i is RoleInference => i.stage === "role" && i.status === "proposed");
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(4, roles.length) }, async () => {
      while (cursor < roles.length) {
        const inference = roles[cursor++]!;
        const result = await ctx.gateway.call<NameRoleResponse>("name_role", { purpose: "name_role", dt: run.timeBase.dt, sensor: sensorSummary(ctx, runId, inference.value.sensor) }, { runId, inferenceId: inference.id, operatorText: false });
        appendLog(ctx.db, { type: "model-call", actor: "agent", runId, inferenceId: inference.id, evidenceIds: inference.evidenceIds, egressId: result.recordId, before: null, after: result.ok ? result.value : null, reason: result.ok ? null : result.reason });
        if (result.ok) supersede(ctx, inference, { ...inference.value, hypothesisName: result.value.name, hypothesisConfidence: result.value.confidence }, result.recordId, "Model role naming hypothesis", (status) => status === "proposed");
      }
    }));
    for (const inference of inferences) if (inference.stage === "diagnosis") await explain(ctx, inference);
  } finally {
    inFlight.delete(runId);
  }
  return true;
}
