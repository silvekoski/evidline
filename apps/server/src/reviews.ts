import { jsonText, validateReview } from "@tpm/egress";
import { CrossReviewResponse, faultFamily, type CrossReviewPayload, type DiagnosisInference, type EgressRecord, type Review, type ReviewJob, type ReviewReport } from "@tpm/schemas";
import type { AppContext } from "./context";
import { appendLog } from "./log";
import { chainOf } from "./operator";
import { explanationPayload } from "./payloads";

let job: ReviewJob | null = null;

export const reviewJob = (): ReviewJob | null => job;

export function reviewPayload(inference: DiagnosisInference): CrossReviewPayload {
  const { purpose: _purpose, faultClass: _faultClass, trace, ...rest } = explanationPayload(inference);
  return { purpose: "cross_review", ...rest, trace: trace.filter((s) => s.test !== "verdict") };
}

function errorOf(record: EgressRecord, verdict: CrossReviewResponse | null): string | null {
  switch (record.status) {
    case "blocked":
      return record.guards.find((g) => !g.pass)?.detail ?? "blocked";
    case "off":
      return "model off";
    case "error":
      return "The reviewer call failed. Open the record for the reply.";
    case "sent":
      if (record.response === null) return job?.inferenceId === record.inferenceId ? null : "The server restarted during the call.";
      if (verdict === null) return "response failed the cross_review response schema";
      return record.validator === null ? "The validator did not run." : null;
  }
}

function reviewOf(record: EgressRecord, head: DiagnosisInference): Review {
  const verdict = record.status === "sent" && record.response !== null ? CrossReviewResponse.safeParse(JSON.parse(jsonText(record.response))).data ?? null : null;
  const checked = record.validator?.pass === true;
  return {
    egressId: record.id,
    inferenceId: record.inferenceId ?? head.id,
    time: record.time,
    model: record.provider?.model ?? "",
    host: record.provider?.host ?? "",
    verdict: verdict && !checked ? { ...verdict, summary: "", concerns: [] } : verdict,
    match: verdict === null ? null : verdict.faultClass === head.value.faultClass ? "class" : faultFamily(verdict.faultClass) === faultFamily(head.value.faultClass) ? "family" : "none",
    validator: record.validator,
    error: errorOf(record, verdict),
  };
}

export function reviewReport(ctx: AppContext, head: DiagnosisInference): ReviewReport {
  const chain = chainOf(ctx.db, head);
  const reviews = chain
    .flatMap((i) => ctx.db.egress.byInference(i.id, "cross_review"))
    .map((record) => reviewOf(record, head))
    .sort((a, b) => b.time.localeCompare(a.time));
  return { pending: job !== null && chain.some((i) => i.id === job?.inferenceId) ? job : null, reviews };
}

export async function runReviews(ctx: AppContext, head: DiagnosisInference): Promise<void> {
  const models = ctx.gateway.reviewers().map((r) => r.model);
  const payload = reviewPayload(head);
  const ctxOf = { runId: head.runId, inferenceId: head.id, operatorText: false };
  job = { inferenceId: head.id, model: models[0] ?? "", index: 0, total: models.length };
  try {
    for (const [index, model] of models.entries()) {
      job = { inferenceId: head.id, model, index, total: models.length };
      const result = await ctx.gateway.call<CrossReviewResponse>("cross_review", payload, ctxOf, model);
      const validator = result.ok ? validateReview(result.value, payload) : null;
      const record = result.recordId === null ? null : ctx.db.egress.get(result.recordId);
      if (record && validator) ctx.db.egress.save({ ...record, validator });
      appendLog(ctx.db, {
        type: "model-call",
        actor: "agent",
        runId: head.runId,
        inferenceId: head.id,
        evidenceIds: head.evidenceIds,
        egressId: result.recordId,
        before: null,
        after: result.ok ? { purpose: "cross_review", model, faultClass: result.value.faultClass, confidence: result.value.confidence, validator } : null,
        reason: result.ok ? null : `${model}: ${result.reason}`,
      });
      if (record?.provider === null) break;
    }
  } finally {
    job = null;
  }
}
