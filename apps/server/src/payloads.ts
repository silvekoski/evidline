import { recordMetric, type DiagnosisInference, type EgressPayload, type RoleInference, type Run, type SensorSummary } from "@tpm/schemas";
import type { AppContext } from "./context";

function roles(ctx: AppContext, runId: string): Map<string, RoleInference> {
  return new Map(ctx.db.inferences.list(runId, "role").filter((i): i is RoleInference => i.stage === "role" && i.status !== "revised").map((i) => [i.value.sensor, i]));
}

type NamePurpose = "name_role" | "check_name";

export function namePayload<P extends NamePurpose>(ctx: AppContext, run: Run, alias: string, purpose: P): Extract<EgressPayload, { purpose: P }> {
  const sensor = ctx.db.sensors.get(run.id, alias);
  if (!sensor) throw new Error(`Unknown sensor ${alias}`);
  const f = sensor.fingerprint;
  const role = roles(ctx, run.id).get(alias);
  const directed = sensor.relations.filter((r) => r.lag !== 0).map((r) => {
    const n = ctx.db.evidence.get(r.evidenceId)?.stats.n ?? sensor.peers.find((p) => p.alias === (r.a === alias ? r.b : r.a))?.n ?? 0;
    return { leads: (r.a === alias ? r.lag : -r.lag) > 0, peer: { alias: r.a === alias ? r.b : r.a, lag: Math.abs(r.lag), rho: r.rhoAtLag, n } };
  }).filter((r) => r.peer.n >= 100);
  const summary: SensorSummary = { alias, n: f.n, signalType: f.signalType, missingRate: f.missingRate, quantiles: f.quantiles, mad: f.mad,
    histogramShares: f.histogram.shares.slice(0, 20), noise: f.noise, acfTime: f.acfTime, period: f.period,
    flatShare: f.flatShare, monotonicShare: f.monotonicShare, distinct: f.distinct, hold: f.hold,
    role: role?.value.role ?? "unknown", roleConfidence: role?.confidence ?? 0,
    leads: directed.filter((r) => r.leads).slice(0, 20).map((r) => r.peer), follows: directed.filter((r) => !r.leads).slice(0, 20).map((r) => r.peer) };
  const metric = run.domain === "records" ? recordMetric(sensor.sourceName) : null;
  return { purpose, dt: run.timeBase.dt, domain: run.domain, metric, sensor: summary } as Extract<EgressPayload, { purpose: P }>;
}

export function catalogFor(ctx: AppContext, runId: string, preferredAliases: string[]): Extract<EgressPayload, { purpose: "compile_rule" }>["catalog"] {
  const byRole = roles(ctx, runId);
  const sensors = ctx.db.sensors.list(runId).sort((a, b) => (byRole.get(b.alias)?.confidence ?? 0) - (byRole.get(a.alias)?.confidence ?? 0));
  const byAlias = new Map(sensors.map((s) => [s.alias, s]));
  return [...new Set([...preferredAliases, ...sensors.map((s) => s.alias)])].filter((a) => byAlias.has(a)).slice(0, 20).map((alias) => ({ alias, signalType: byAlias.get(alias)!.fingerprint.signalType, role: byRole.get(alias)?.value.role ?? "unknown" }));
}

export function explanationPayload(inference: DiagnosisInference): Extract<EgressPayload, { purpose: "explain_diagnosis" }> {
  const v = inference.value;
  const sorted = [...v.ranked].sort((a, b) => b.contribution - a.contribution);
  const top = sorted.slice(0, 20);
  const total = top.reduce((sum, r) => sum + Math.max(0, r.contribution), 0);
  return { purpose: "explain_diagnosis", faultClass: v.faultClass, n: v.window.n, onset: v.onset,
    ranked: top.map((r) => ({ alias: r.sensor, contribution: total > 0 ? Math.max(0, r.contribution) / total : 1 / top.length })),
    excluded: [...new Set([...v.excluded, ...sorted.slice(20).map((r) => r.sensor)])].slice(0, 20),
    trace: v.trace.slice(0, 20).map((s) => ({ index: s.index, test: s.test, name: s.name, n: s.n,
      stats: Object.fromEntries(Object.entries(s.stats).filter(([key, value]) => /^[a-zA-Z0-9_]{1,32}$/.test(key) && Number.isFinite(value)).slice(0, 20)),
      result: s.result, evidenceIds: s.evidenceIds.slice(0, 20) })) };
}
