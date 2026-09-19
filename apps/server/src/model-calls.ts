import { fallback, validateProse } from "@tpm/egress";
import { faultLabel, type DiagnosisInference, type ExplainDiagnosisResponse, type Inference, type NameRoleResponse } from "@tpm/schemas";
import type { AppContext } from "./context";
import { appendLog } from "./log";
import { createInference } from "./persist";
import { explanationPayload, sensorSummary } from "./payloads";

function revise(ctx: AppContext, old: Inference, value: Inference["value"], recordId: string | null, reason: string): void {
  ctx.db.transaction(() => {
    // Operator edits made during a provider call win over its delayed response.
    if (ctx.db.inferences.get(old.id)?.status === "revised") return;
    ctx.db.inferences.save({ ...old, status: "revised" });
    const next = createInference(ctx.db, { ...old, value, status: "proposed", supersedes: old.id } as Parameters<typeof createInference>[1]);
    appendLog(ctx.db, { type: "inference", actor: "agent", runId: old.runId, inferenceId: next.id, evidenceIds: next.evidenceIds, egressId: recordId, before: old.value, after: value, reason });
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
  revise(ctx, inference, { ...inference.value, prose }, result.recordId, `Diagnosis explanation (${source})`);
}

export async function runModelCalls(ctx: AppContext, runId: string): Promise<void> {
  const run = ctx.db.runs.get(runId);
  if (!run) throw new Error(`Unknown run ${runId}`);
  const inferences = ctx.db.inferences.list(runId).filter((i) => i.status !== "revised");
  const roles = inferences.filter((i) => i.stage === "role");
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, roles.length) }, async () => {
    while (cursor < roles.length) {
      const inference = roles[cursor++]!;
      const result = await ctx.gateway.call<NameRoleResponse>("name_role", { purpose: "name_role", dt: run.timeBase.dt, sensor: sensorSummary(ctx, runId, inference.value.sensor) }, { runId, inferenceId: inference.id, operatorText: false });
      appendLog(ctx.db, { type: "model-call", actor: "agent", runId, inferenceId: inference.id, evidenceIds: inference.evidenceIds, egressId: result.recordId, before: null, after: result.ok ? result.value : null, reason: result.ok ? null : result.reason });
      if (result.ok) revise(ctx, inference, { ...inference.value, hypothesisName: result.value.name, hypothesisConfidence: result.value.confidence }, result.recordId, "Model role naming hypothesis");
    }
  }));
  for (const inference of inferences) if (inference.stage === "diagnosis") await explain(ctx, inference);
}
