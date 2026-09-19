import { binarySegmentation, countViolations, crossCorrelation, histogram, mad, quantiles, restateRule, scoreRoles, spearman, wasserstein1, window, type EvidenceSink, type RoleResult } from "@tpm/core";
import type { ChartSeries, Overrides, ToolCall, Window } from "@tpm/schemas";
import { HTTPException } from "hono/http-exception";
import type { AppContext } from "./context";
import { addEvidence, storedSource } from "./persist";
import { runPipelineJob, type PipelineOutput } from "./pipeline-worker";
import { notFound } from "./request";

export type ToolResult = { text: string; evidenceIds: string[]; result?: PipelineOutput; role?: RoleResult };

/** Half-open windows may be empty after clamping; never invent samples outside the request. */
export function clampWindow(w: { from: number; to: number }, n: number): Window {
  const from = Math.max(0, Math.min(n, Math.trunc(w.from)));
  return window(from, Math.max(from, Math.min(n, Math.trunc(w.to))));
}

const series = (alias: string): ChartSeries => ({ key: alias, label: alias, source: { sensor: alias }, style: "solid" });

export async function executeTool(ctx: AppContext, runId: string, call: ToolCall, overrides: Overrides): Promise<ToolResult> {
  const { db } = ctx;
  const run = db.runs.get(runId);
  const grid = db.grids.load(runId);
  if (!run || !grid) throw notFound("run grid");
  const aliases = call.tool === "test_relation" ? [call.a, call.b] : call.tool === "check_rule" ? [call.rule.sensor, ...(call.rule.type === "relation" ? [call.rule.sensor2] : [])] : [call.sensor];
  for (const alias of aliases) {
    if (!grid.aliases.includes(alias)) throw new HTTPException(422, { message: `Unknown sensor ${alias}` });
  }
  const created: string[] = [];
  const sink: EvidenceSink = {
    add(input, derived) {
      const id = addEvidence(db, runId, input, derived, { tool: call.tool, method: input.method });
      created.push(id);
      return id;
    },
  };
  const get = (alias: string) => grid.values[grid.aliases.indexOf(alias)]!;
  const episodesWithin = (w: Window) => grid.episodes.flatMap((episode) => {
    const from = Math.max(w.from, episode.from);
    const to = Math.min(w.to, episode.to);
    return to > from ? [window(from - w.from, to - w.from)] : [];
  });
  switch (call.tool) {
    case "compare_windows": {
      const a = clampWindow(call.a, grid.n);
      const b = clampWindow(call.b, grid.n);
      const x = get(call.sensor).subarray(a.from, a.to);
      const y = get(call.sensor).subarray(b.from, b.to);
      const qa = quantiles(x);
      const qb = quantiles(y);
      const lo = Math.min(qa.p1, qb.p1);
      const hi = Math.max(qa.p99, qb.p99);
      const w = window(Math.min(a.from, b.from), Math.max(a.to, b.to));
      const distance = wasserstein1(x, y);
      const text = `${call.sensor}: window A [${a.from}, ${a.to}) median ${qa.p50}; window B [${b.from}, ${b.to}) median ${qb.p50}; Wasserstein distance ${distance}.`;
      sink.add({ kind: "distribution", sensors: aliases, window: w, method: "compare_windows", stats: { aFrom: a.from, aTo: a.to, bFrom: b.from, bTo: b.to, aN: x.filter(Number.isFinite).length, bN: y.filter(Number.isFinite).length, aMedian: qa.p50, bMedian: qb.p50, aMad: mad(x), bMad: mad(y), wasserstein: distance }, verdict: text, chart: { type: "histogram", window: w, series: [series(call.sensor)], histograms: [{ label: "A", ...histogram(x, lo, hi) }, { label: "B", ...histogram(y, lo, hi) }] } });
      return { text, evidenceIds: created };
    }
    case "test_relation": {
      const w = clampWindow(call.window, grid.n);
      const a = get(call.a).subarray(w.from, w.to);
      const b = get(call.b).subarray(w.from, w.to);
      const rho = spearman(a, b);
      const xc = crossCorrelation(a, b, Math.min(64, Math.max(0, w.n - 2)), episodesWithin(w));
      const text = `${call.a} and ${call.b}: Spearman rho ${rho.rho}; best lag ${xc.bestLag} samples, rho ${xc.bestRho}.`;
      sink.add({ kind: "lag", sensors: aliases, window: w, method: "spearman+xcorr", stats: { rho: rho.rho, n: rho.n, lag: xc.bestLag, rhoAtLag: xc.bestRho }, verdict: text, chart: { type: "lag", window: w, series: aliases.map(series), lags: xc.lags.map((lag, i) => ({ lag, rho: xc.rhos[i]! })) } });
      return { text, evidenceIds: created };
    }
    case "find_changepoints": {
      const near = Math.max(0, Math.min(grid.n, call.near));
      const span = Math.max(0, Math.min(grid.n, call.span));
      const w = clampWindow({ from: near - span, to: near + span }, grid.n);
      const points = binarySegmentation(get(call.sensor).subarray(w.from, w.to), { episodes: episodesWithin(w) }).map((p) => p + w.from);
      const text = `${call.sensor}: ${points.length} change points in [${w.from}, ${w.to}): ${points.join(", ") || "none"}.`;
      sink.add({ kind: "changepoint", sensors: aliases, window: w, method: "binarySegmentation", stats: { count: points.length, near, span }, verdict: text, chart: { type: "line", window: w, series: aliases.map(series), marks: points.map((at) => ({ at, label: `change ${at}`, kind: "changepoint" })) } });
      return { text, evidenceIds: created };
    }
    case "check_rule": {
      const w = clampWindow(call.window, grid.n);
      const violations = countViolations(call.rule, grid, w);
      const text = `${restateRule(call.rule)}: ${violations} violations in [${w.from}, ${w.to}).`;
      sink.add({ kind: "rule", sensors: aliases, window: w, method: call.rule.type, stats: { violations, n: w.n }, verdict: text, chart: { type: "line", window: w, series: aliases.map(series) } });
      return { text, evidenceIds: created };
    }
    case "test_role": {
      const sensors = db.sensors.list(runId);
      const baselineInference = db.inferences.list(runId, "baseline").filter((i) => i.stage === "baseline" && i.status !== "revised").at(-1);
      const baseline = clampWindow(overrides.baseline ?? (baselineInference?.stage === "baseline" ? baselineInference.value.window : window(0, grid.n)), grid.n);
      const relationMap = new Map(sensors.flatMap((s) => s.relations).map((r) => [`${r.a}|${r.b}`, r]));
      const groupMap = new Map(sensors.flatMap((s) => s.redundancyGroup ? [s.redundancyGroup] : []).map((g) => [g.evidenceId, g]));
      const selected = scoreRoles(grid, grid.aliases.map((alias) => {
        const sensor = sensors.find((s) => s.alias === alias);
        if (!sensor) throw notFound(`sensor fingerprint ${alias}`);
        return sensor.fingerprint;
      }), { relations: [...relationMap.values()], groups: [...groupMap.values()], flowOrder: sensors.filter((s) => s.flowIndex !== null).sort((a, b) => a.flowIndex! - b.flowIndex!).map((s) => s.alias), peers: new Map(sensors.map((s) => [s.alias, s.peers])) }, baseline, sink).find((r) => r.value.sensor === call.sensor)!;
      const text = `${call.sensor}: ${call.role} score ${selected.value.scores[call.role]}; best supported role is ${selected.value.role}.`;
      return { text, evidenceIds: selected.evidenceIds, role: selected };
    }
    case "rerun_without": {
      const output = await runPipelineJob({ runId, overrides: { ...overrides, masked: [...new Set([...(overrides.masked ?? []), call.sensor])] }, source: storedSource(db, run, grid) }, () => {});
      const result = db.transaction(() => {
        const remap = new Map<string, string>();
        for (const evidence of output.evidence) remap.set(evidence.id, sink.add(evidence, output.derived.get(evidence.id)));
        // Preserve Maps and typed arrays while rewriting every nested evidence reference.
        const rewrite = (value: unknown): unknown => {
          if (typeof value === "string") return remap.get(value) ?? value;
          if (Array.isArray(value)) return value.map(rewrite);
          if (value instanceof Map) return new Map([...value].map(([key, item]) => [key, rewrite(item)]));
          if (ArrayBuffer.isView(value)) return value;
          if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewrite(item)]));
          return value;
        };
        return rewrite(output.result) as PipelineOutput;
      });
      return { text: `Reran drift and diagnosis with ${call.sensor} masked; ${result.drifts.length} drift results and ${result.incidents.length} diagnoses.`, evidenceIds: created, result };
    }
  }
}
