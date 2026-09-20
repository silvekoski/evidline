import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { OverrideBody, QuestionBody, type ActionResponse, type DiagnosisInference,
  type RoleInference, type Inference, type OverrideValue, type PlanInvestigationResponse, type Stage } from "@tpm/schemas";
import type { AppContext } from "../context";
import { executeTool, type ToolResult } from "../investigation-tools";
import { appendLog, type LogInput } from "../log";
import { addThread, changedPairs, clampCall, describeCall, describeOverride, headOf, outcome, overrideOf, overridesOf, planPayload, threadOf, type Outcome } from "../operator";
import { createInference, leadSensor, storedSource, type InferenceDraft } from "../persist";
import { currentInferences } from "../reports";
import { badRequest, notFound, parseBody } from "../request";
import { nameCheckReport, runNameChecks } from "../name-checks";
import { reviewJob, reviewReport, runReviews } from "../reviews";
import { startRun } from "../run-service";
import { getModelMode } from "../settings";

const stagesFor: Record<OverrideValue["kind"], Stage[]> = { role: ["role"], faultClass: ["diagnosis"], baseline: ["baseline"], responsible: ["drift", "diagnosis"] };

export function inferencesRoutes(ctx: AppContext) {
  const { db } = ctx;
  const inferenceOf = (id: string): Inference => {
    const inference = db.inferences.get(id);
    if (!inference) throw notFound("inference");
    return inference;
  };
  const entry = (inference: Inference, type: LogInput["type"], actor: LogInput["actor"], patch: Partial<LogInput> = {}): void => {
    appendLog(db, { type, actor, runId: inference.runId, inferenceId: inference.id, evidenceIds: [], egressId: null, before: null, after: null, reason: null, ...patch });
  };
  const response = (inference: Inference, rerunId: string | null, changed: ActionResponse["changed"]): ActionResponse => ({ inference, thread: threadOf(db, inference), rerunId, changed });
  const roleOf = (id: string): RoleInference => {
    const head = headOf(db, inferenceOf(id));
    if (head.stage !== "role") throw badRequest("name checks exist for a role only");
    return head;
  };
  const diagnosisOf = (id: string): DiagnosisInference => {
    const head = headOf(db, inferenceOf(id));
    if (head.stage !== "diagnosis") throw badRequest("reviews exist for a diagnosis only");
    return head;
  };

  return new Hono()
    .get("/:id", (c) => c.json(inferenceOf(c.req.param("id"))))
    .get("/:id/head", (c) => c.json(headOf(db, inferenceOf(c.req.param("id")))))
    .get("/:id/thread", (c) => c.json(threadOf(db, inferenceOf(c.req.param("id")))))
    .get("/:id/name-checks", (c) => c.json(nameCheckReport(ctx, roleOf(c.req.param("id")))))
    .post("/:id/name-check", async (c) => {
      const head = roleOf(c.req.param("id"));
      if (ctx.gateway.reviewers().length === 0) throw new HTTPException(422, { message: "no reviewer: set TPM_REVIEW_KEY and mode cloud" });
      if (!(await runNameChecks(ctx, head.runId, [head], { again: true }))) throw new HTTPException(409, { message: "name checks for this run are in flight" });
      return c.json(nameCheckReport(ctx, head));
    })
    .get("/:id/reviews", (c) => c.json(reviewReport(ctx, diagnosisOf(c.req.param("id")))))
    .post("/:id/review", (c) => {
      const head = diagnosisOf(c.req.param("id"));
      const mode = getModelMode(db, ctx.gateway);
      if (mode !== "cloud") throw badRequest(mode === "off" ? "model off" : "reviewers need mode cloud");
      if (ctx.gateway.reviewers().length === 0) throw badRequest("no reviewer is set");
      const running = reviewJob();
      if (running) throw new HTTPException(409, { message: `a review for ${running.inferenceId} is in flight` });
      runReviews(ctx, head).catch((e: unknown) => ctx.log(`review of ${head.id} failed: ${e instanceof Error ? e.message : String(e)}`));
      return c.json(reviewReport(ctx, head), 202);
    })
    .post("/:id/accept", (c) => {
      const accepted = db.transaction(() => {
        const inference = headOf(db, inferenceOf(c.req.param("id")));
        db.inferences.save({ ...inference, status: "accepted" });
        entry(inference, "accept", "operator", { evidenceIds: inference.evidenceIds, before: inference.status, after: "accepted" });
        addThread(db, inference.id, "accept", "Accepted by the operator.");
        return { ...inference, status: "accepted" as const };
      });
      return c.json(response(accepted, null, []));
    })
    .post("/:id/question", async (c) => {
      const { text } = await parseBody(c, QuestionBody);
      const inference = headOf(db, inferenceOf(c.req.param("id")));
      const run = db.runs.get(inference.runId);
      if (!run) throw notFound("run");
      const overrides = overridesOf(db, run.id);
      db.transaction(() => {
        db.inferences.save({ ...inference, status: "questioned" });
        entry(inference, "question", "operator", { reason: text });
        addThread(db, inference.id, "question", text);
      });
      const plan = await ctx.gateway.call<PlanInvestigationResponse>("plan_investigation", planPayload(ctx, run, inference, text, overrides), { runId: run.id, inferenceId: inference.id, operatorText: true });
      entry(inference, "model-call", "agent", { egressId: plan.recordId, after: plan.ok ? plan.value : null, reason: plan.ok ? null : plan.reason });
      if (!plan.ok) {
        addThread(db, inference.id, "verdict", `No investigation plan: ${plan.reason}.`, [], plan.recordId);
        return c.json(response(inferenceOf(inference.id), null, []));
      }
      const calls = plan.value.calls.map((call) => clampCall(call, run.gridSize));
      addThread(db, inference.id, "plan", `${plan.value.rationale} Calls: ${calls.map(describeCall).join("; ")}.`, [], plan.recordId);
      const cited: string[] = [];
      let revision: Outcome | null = null;
      let completed = 0;
      for (const call of calls) {
        let result: ToolResult;
        try {
          result = await executeTool(ctx, run.id, call, overrides);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          ctx.log(`question on ${inference.id}: ${describeCall(call)} failed: ${message}`);
          addThread(db, inference.id, "result", `${describeCall(call)} failed: ${message}`);
          continue;
        }
        completed++;
        const found = outcome(inference, result, run.gridSize, overrides);
        const evidenceIds = (found?.next.evidenceIds ?? result.result?.incidents.flatMap((i) => i.evidenceIds) ?? result.evidenceIds).slice(0, 20);
        cited.push(...evidenceIds);
        addThread(db, inference.id, "result", result.text, evidenceIds);
        if (found?.changed && revision === null) revision = found.next;
      }
      if (completed === 0) {
        addThread(db, inference.id, "verdict", "The investigation failed: no tool call completed. The inference stays questioned.");
        return c.json(response(inferenceOf(inference.id), null, []));
      }
      if (revision === null) {
        const accepted = db.transaction(() => {
          const current: Inference = { ...headOf(db, inference), status: "accepted" };
          db.inferences.save(current);
          entry(current, "accept", "agent", { evidenceIds: cited, before: "questioned", after: "accepted", reason: "New evidence confirms the inference." });
          addThread(db, inference.id, "verdict", `Confirmed: ${inference.claim}`, cited);
          return current;
        });
        return c.json(response(accepted, null, []));
      }
      const next = revision;
      const [revised, created] = db.transaction(() => {
        const current: Inference = { ...headOf(db, inference), status: "revised" };
        db.inferences.save(current);
        const draft = { ...current, value: next.value, claim: next.claim, confidence: next.confidence, evidenceIds: next.evidenceIds, status: "proposed", supersedes: current.id } as InferenceDraft;
        const superseding = createInference(db, draft);
        entry(superseding, "inference", "agent", { evidenceIds: superseding.evidenceIds, before: current.value, after: superseding.value, reason: "New evidence revises the inference." });
        addThread(db, inference.id, "verdict", `Revised: ${superseding.claim}`, superseding.evidenceIds);
        return [current, superseding];
      });
      return c.json(response(revised, null, [{ before: revised, after: created }]));
    })
    .post("/:id/override", async (c) => {
      const { value, reason } = await parseBody(c, OverrideBody);
      const inference = headOf(db, inferenceOf(c.req.param("id")));
      if (!stagesFor[value.kind].includes(inference.stage)) throw badRequest(`a ${value.kind} override does not apply to a ${inference.stage} inference`);
      const run = db.runs.get(inference.runId);
      if (!run) throw notFound("run");
      const source = storedSource(db, run);
      const lead = inference.stage === "diagnosis" ? leadSensor(inference.value) : null;
      const before = value.kind === "responsible" && inference.stage === "diagnosis" ? (lead === null ? null : { kind: "responsible", sensor: lead }) : overrideOf(inference);
      const overridden: Inference = { ...inference, status: "overridden" };
      db.transaction(() => {
        db.inferences.save(overridden);
        entry(inference, "override", "operator", { before, after: value, reason });
        addThread(db, inference.id, "override", `${describeOverride(value)}. ${reason}`);
      });
      const child = startRun(ctx, { source, name: run.name, parentRunId: run.id, overrides: overridesOf(db, run.id) });
      const finished = await child.done;
      if (finished.status !== "done") {
        addThread(db, inference.id, "result", `Rerun ${child.run.id} failed: ${finished.error ?? "unknown error"}`);
        return c.json(response(overridden, child.run.id, []));
      }
      const changed = changedPairs(currentInferences(db, run.id), currentInferences(db, child.run.id)).map((pair) => ({
        before: { ...pair.before, status: "overridden" as const },
        after: { ...pair.after, supersedes: pair.before.id },
      }));
      db.transaction(() => {
        for (const pair of changed) {
          db.inferences.save(pair.before);
          db.inferences.save(pair.after);
        }
      });
      return c.json(response(overridden, child.run.id, changed));
    });
}
