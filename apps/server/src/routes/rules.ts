import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { countViolations, restateRule, window } from "@tpm/core";
import { CompileRuleBody, type CompileRuleResponse, type CompileRuleResult, type Rule } from "@tpm/schemas";
import type { AppContext } from "../context";
import { newRuleId } from "../ids";
import { appendLog } from "../log";
import { catalogFor } from "../payloads";
import { addEvidence, createInference } from "../persist";
import { notFound, parseBody } from "../request";

const unprocessable = (message: string): HTTPException => new HTTPException(422, { message });

export function rulesRoutes(ctx: AppContext) {
  const { db } = ctx;
  return new Hono()
    .post("/compile", async (c) => {
      const { runId, sentence } = await parseBody(c, CompileRuleBody);
      const run = db.runs.get(runId);
      const grid = db.grids.load(runId);
      if (!run || !grid) throw notFound("run");
      const named = sentence.toUpperCase().match(/\bS\d{2,4}\b/g) ?? [];
      const payload = { purpose: "compile_rule" as const, sentence, dt: run.timeBase.dt, n: run.gridSize, catalog: catalogFor(ctx, runId, named) };
      const result = await ctx.gateway.call<CompileRuleResponse>("compile_rule", payload, { runId, inferenceId: null, operatorText: true });
      if (!result.ok) throw unprocessable(result.reason);
      const rule = { ...result.value.rule, source: sentence };
      const sensors = [rule.sensor, ...(rule.type === "relation" ? [rule.sensor2] : [])];
      for (const alias of sensors) if (!grid.aliases.includes(alias)) throw unprocessable(`Unknown sensor ${alias}`);
      const restated = restateRule(rule);
      const whole = window(0, grid.n);
      const violations = countViolations(rule, grid, whole);
      const verdict = `${restated}: ${violations} violations on the whole grid.`;
      const saved = db.transaction(() => {
        const evidenceId = addEvidence(db, runId, {
          kind: "rule",
          sensors,
          window: whole,
          method: rule.type,
          stats: { n: grid.n, violations },
          verdict,
          chart: {
            type: "line",
            window: whole,
            series: sensors.map((alias) => ({ key: alias, label: alias, source: { sensor: alias }, style: "solid" as const })),
            ...(rule.type === "range" && rule.min !== undefined && rule.max !== undefined ? { band: { lo: rule.min, hi: rule.max, label: "rule range" } } : {}),
          },
        }, undefined, { purpose: "compile_rule", sentence });
        const inference = createInference(db, { runId, stage: "rule", sensor: rule.sensor, claim: `Operator rule: ${verdict}`, confidence: 1, evidenceIds: [evidenceId], status: "proposed", supersedes: null, value: { rule, restated, violations, active: false } });
        const row: Rule = { id: newRuleId(), runId, rule, restated, violations, active: false, origin: "operator", inferenceId: inference.id, evidenceId };
        db.rules.save(row);
        appendLog(db, { type: "rule-compiled", actor: "operator", runId, inferenceId: inference.id, evidenceIds: [evidenceId], egressId: result.recordId, before: null, after: { ruleId: row.id, rule, restated, violations, source: result.source }, reason: sentence });
        return row;
      });
      return c.json({ rule: saved, egressId: result.recordId } satisfies CompileRuleResult, 201);
    })
    .post("/:id/activate", (c) => {
      const rule = db.rules.get(c.req.param("id"));
      if (!rule) throw notFound("rule");
      const active: Rule = { ...rule, active: true };
      db.transaction(() => {
        db.rules.save(active);
        const inference = db.inferences.get(rule.inferenceId);
        if (inference?.stage === "rule") db.inferences.save({ ...inference, value: { ...inference.value, active: true } });
        appendLog(db, { type: "rule-activated", actor: "operator", runId: rule.runId, inferenceId: rule.inferenceId, evidenceIds: [rule.evidenceId], egressId: null, before: { active: rule.active }, after: { active: true }, reason: null });
      });
      return c.json(active);
    });
}
