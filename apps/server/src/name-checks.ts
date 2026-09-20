import { jsonText } from "@tpm/egress";
import { CheckNameResponse, NameRoleResponse, type EgressRecord, type NameCheck, type NameCheckJob, type NameCheckReport, type PrimaryName, type RoleInference } from "@tpm/schemas";
import type { AppContext } from "./context";
import { appendLog } from "./log";
import { chainOf } from "./operator";
import { refreshCatalog } from "./catalog";
import { namePayload } from "./payloads";

const jobs = new Map<string, NameCheckJob>();
export const nameCheckJob = (runId: string): NameCheckJob | null => jobs.get(runId) ?? null;

const stop = new Set(["the", "of", "a", "an", "in", "for", "and", "or", "to", "with", "sensor", "signal", "reading", "measurement", "variable", "value", "indicator", "process", "level", "rate", "channel", "check"]);

const quantities: Record<string, string[]> = {
  temperature: ["temp"],
  pressure: ["press"],
  flow: ["flowrate", "feed", "throughput"],
  speed: ["velocity", "rpm"],
  position: ["opening", "travel", "stroke"],
  valve: ["actuator", "damper"],
  setpoint: ["reference", "target", "setting", "sp"],
  counter: ["count", "cycle", "step", "batch", "index", "sequence", "timer", "clock"],
  state: ["status", "mode", "flag", "discrete", "identifier", "id", "boolean"],
  voltage: ["volt"],
  current: ["amperage", "amp"],
  power: ["watt"],
  frequency: ["hz"],
  concentration: ["composition", "purity"],
  humidity: ["moisture"],
  vibration: ["acceleration"],
  torque: [],
  density: [],
  ph: [],
};
const concept = new Map<string, string>(Object.entries(quantities).flatMap(([q, aliases]) => [q, ...aliases].map((word) => [word, q] as const)));
const singular = (t: string): string => t.replace(/s$/, "");
const tokens = (name: string): Set<string> => new Set(name.toLowerCase().normalize("NFKC").match(/[\p{L}\p{N}]+/gu)?.filter((t) => !stop.has(t)).map((t) => concept.get(t) ?? concept.get(singular(t)) ?? singular(t)) ?? []);

export function namesAgree(a: string | null, b: string | null): boolean | null {
  if (a === null || b === null) return null;
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return a.trim().toLowerCase() === b.trim().toLowerCase();
  const shared = [...ta].filter((t) => tb.has(t));
  return shared.some((t) => t in quantities) || shared.length / Math.min(ta.size, tb.size) >= 0.5;
}

const replyOf = <T>(record: EgressRecord, schema: { safeParse: (x: unknown) => { data?: T } }): T | null =>
  record.status === "sent" && record.response !== null ? (schema.safeParse(JSON.parse(jsonText(record.response))).data ?? null) : null;

function checkOf(record: EgressRecord, hypothesis: string | null): NameCheck {
  const reply = replyOf(record, CheckNameResponse);
  const error =
    record.status === "blocked" ? (record.guards.find((g) => !g.pass)?.detail ?? "blocked")
    : record.status === "off" ? "model off"
    : record.status === "error" ? "The reviewer call failed."
    : reply === null ? "response failed the schema"
    : null;
  return {
    egressId: record.id,
    time: record.time,
    model: record.provider?.model ?? "",
    host: record.provider?.host ?? "",
    name: reply?.name ?? null,
    quantity: reply?.quantity ?? null,
    confidence: reply?.confidence ?? null,
    reason: reply?.reason ?? null,
    agrees: namesAgree(reply?.name ?? null, hypothesis),
    error,
  };
}

export function primaryName(ctx: AppContext, head: RoleInference): PrimaryName | null {
  let primary: PrimaryName | null = null;
  for (const inference of chainOf(ctx.db, head)) {
    for (const record of ctx.db.egress.byInference(inference.id, "name_role")) {
      const reply = replyOf(record, NameRoleResponse);
      if (reply === null || (primary !== null && primary.time >= record.time)) continue;
      primary = { egressId: record.id, time: record.time, model: record.provider?.model ?? "", host: record.provider?.host ?? "", name: reply.name, quantity: reply.quantity, confidence: reply.confidence, reason: reply.reason };
    }
  }
  return primary;
}

export function nameChecks(ctx: AppContext, head: RoleInference): NameCheck[] {
  const byModel = new Map<string, NameCheck>();
  for (const inference of chainOf(ctx.db, head)) {
    for (const record of ctx.db.egress.byInference(inference.id, "check_name")) {
      const check = checkOf(record, head.value.hypothesisName);
      if (!byModel.has(check.model) || byModel.get(check.model)!.time < check.time) byModel.set(check.model, check);
    }
  }
  return [...byModel.values()].sort((a, b) => a.model.localeCompare(b.model));
}

export const nameCheckReport = (ctx: AppContext, head: RoleInference): NameCheckReport => ({ pending: jobs.get(head.runId) ?? null, primary: primaryName(ctx, head), checks: nameChecks(ctx, head) });

export async function runNameChecks(ctx: AppContext, runId: string, heads: RoleInference[], opts: { again?: boolean } = {}): Promise<boolean> {
  if (jobs.has(runId)) return false;
  const models = ctx.gateway.reviewers().map((r) => r.model);
  const run = ctx.db.runs.get(runId);
  if (!run || models.length === 0) return false;
  const done = new Set(heads.flatMap((head) => ctx.db.egress.byInference(head.id, "check_name").filter((r) => r.status === "sent" && r.response !== null).map((r) => `${head.id}:${r.provider?.model ?? ""}`)));
  const work = heads.flatMap((head) => models.map((model) => ({ head, model }))).filter(({ head, model }) => opts.again || !done.has(`${head.id}:${model}`));
  if (work.length === 0) return true;
  jobs.set(runId, { runId, done: 0, total: work.length, model: models[0] ?? "" });
  try {
    let cursor = 0;
    await Promise.all(
      Array.from({ length: Math.min(4, work.length) }, async () => {
        while (cursor < work.length) {
          const { head, model } = work[cursor++]!;
          const result = await ctx.gateway.call<CheckNameResponse>("check_name", namePayload(ctx, run, head.value.sensor, "check_name"), { runId, inferenceId: head.id, operatorText: false }, model);
          appendLog(ctx.db, {
            type: "model-call",
            actor: "agent",
            runId,
            inferenceId: head.id,
            evidenceIds: head.evidenceIds,
            egressId: result.recordId,
            before: null,
            after: result.ok ? { purpose: "check_name", model, name: result.value.name, confidence: result.value.confidence, agrees: namesAgree(result.value.name, head.value.hypothesisName) } : null,
            reason: result.ok ? null : `${model}: ${result.reason}`,
          });
          const job = jobs.get(runId);
          if (job) jobs.set(runId, { ...job, done: job.done + 1, model });
        }
      }),
    );
  } finally {
    jobs.delete(runId);
  }
  refreshCatalog(ctx, runId);
  return true;
}
