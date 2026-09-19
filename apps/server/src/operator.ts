import { restateRule, window } from "@tpm/core";
import { z } from "zod";
import { InvestigationTool, OverrideValue, Overrides, type DiagnosisValue, type EgressPayload, type Inference, type Run, type ThreadEntry, type ToolCall, type WindowArg } from "@tpm/schemas";
import type { AppContext } from "./context";
import type { Db } from "./db";
import { newThreadId } from "./ids";
import { clampWindow, type ToolResult } from "./investigation-tools";
import { listLog } from "./log";
import { catalogFor } from "./payloads";
import { leadSensor } from "./persist";
import { currentInferences } from "./reports";

export type Outcome = { value: Inference["value"]; claim: string; confidence: number; evidenceIds: string[] };

const rerunEntry = z.object({ overrides: Overrides });

export function addThread(db: Db, inferenceId: string, kind: ThreadEntry["kind"], text: string, evidenceIds: string[] = [], egressId: string | null = null): ThreadEntry {
  const entry: ThreadEntry = { id: newThreadId(), inferenceId, time: new Date().toISOString(), kind, text, evidenceIds, egressId };
  db.threads.save(entry);
  return entry;
}

export function headOf(db: Db, inference: Inference): Inference {
  let head = inference;
  for (let next = db.inferences.successor(head.id, head.runId); next !== null; next = db.inferences.successor(head.id, head.runId)) head = next;
  return head;
}

export function threadOf(db: Db, inference: Inference): ThreadEntry[] {
  const chain = [inference];
  for (let next = inference.supersedes; next !== null && !chain.some((i) => i.id === next); next = chain.at(-1)!.supersedes) {
    const i = db.inferences.get(next);
    if (!i) break;
    chain.push(i);
  }
  return chain.reverse().flatMap((i) => db.threads.list(i.id)).sort((a, b) => a.time.localeCompare(b.time));
}

export function overrideOf(inference: Inference): OverrideValue | null {
  switch (inference.stage) {
    case "role":
      return { kind: "role", role: inference.value.role };
    case "baseline":
      return { kind: "baseline", window: inference.value.window };
    case "diagnosis":
      return { kind: "faultClass", faultClass: inference.value.faultClass };
    case "drift":
      return inference.value.responsible === null ? null : { kind: "responsible", sensor: inference.value.responsible };
    default:
      return null;
  }
}

export function describeOverride(value: OverrideValue): string {
  switch (value.kind) {
    case "role":
      return `Role set to ${value.role}`;
    case "faultClass":
      return `Fault class set to ${value.faultClass}`;
    case "baseline":
      return `Baseline set to samples ${value.window.from} to ${value.window.to}`;
    case "responsible":
      return `Responsible sensor set to ${value.sensor}`;
  }
}

export function overridesOf(db: Db, runId: string): Overrides {
  const entries = listLog(db, runId);
  const rerun = rerunEntry.safeParse(entries.find((e) => e.type === "rerun")?.after);
  const overrides: Overrides = rerun.success ? rerun.data.overrides : {};
  const byId = new Map(db.inferences.list(runId).map((i) => [i.id, i]));
  const apply = (i: Inference, o: OverrideValue): void => {
    if (o.kind === "role" && i.sensor !== null) (overrides.roles ??= {})[i.sensor] = o.role;
    else if (o.kind === "baseline") overrides.baseline = o.window;
    else if (o.kind === "faultClass" && i.stage === "diagnosis") {
      const lead = leadSensor(i.value);
      if (lead !== null) (overrides.faultClass ??= {})[lead] = o.faultClass;
    } else if (o.kind === "responsible") {
      for (const s of i.stage === "diagnosis" ? i.value.ranked.map((r) => r.sensor) : [i.sensor]) if (s !== null) (overrides.responsible ??= {})[s] = o.sensor;
    }
  };
  for (const i of byId.values()) {
    const o = i.status === "accepted" ? overrideOf(i) : null;
    if (o) apply(i, o);
  }
  for (const entry of entries) {
    const i = entry.type === "override" && entry.inferenceId !== null ? byId.get(entry.inferenceId) : undefined;
    const o = OverrideValue.safeParse(entry.after);
    if (i && o.success) apply(i, o.data);
  }
  return overrides;
}

export function planPayload(ctx: AppContext, run: Run, inference: Inference, question: string, overrides: Overrides): Extract<EgressPayload, { purpose: "plan_investigation" }> {
  const { db } = ctx;
  const sensor = inference.sensor;
  const record = sensor === null ? null : db.sensors.get(run.id, sensor);
  const flow = record?.flowIndex ?? null;
  const neighbors = flow === null ? [] : db.sensors.list(run.id).filter((s) => s.flowIndex !== null && Math.abs(s.flowIndex - flow) === 1).map((s) => s.alias);
  const preferred = [
    ...(question.toUpperCase().match(/\bS\d{2,4}\b/g) ?? []),
    ...(sensor === null ? [] : [sensor]),
    ...(record?.peers.map((p) => p.alias) ?? []),
    ...(record?.redundancyGroup?.sensors ?? []),
    ...neighbors,
  ];
  const baselineInference = currentInferences(db, run.id).find((i) => i.stage === "baseline");
  const baseline = overrides.baseline ?? (baselineInference?.stage === "baseline" ? baselineInference.value.window : window(0, run.gridSize));
  const onset = inference.stage === "drift" || inference.stage === "diagnosis" ? inference.value.onset : null;
  const masked = inference.stage === "health" ? inference.value.masked.slice(0, 20).map(({ from, to }) => ({ from, to })) : [];
  return {
    purpose: "plan_investigation",
    question,
    dt: run.timeBase.dt,
    n: run.gridSize,
    inference: { stage: inference.stage, claim: inference.claim.slice(0, 300), sensor, onset, baseline: { from: baseline.from, to: baseline.to }, masked },
    catalog: catalogFor(ctx, run.id, preferred),
    tools: InvestigationTool.options,
  };
}

export function clampCall(call: ToolCall, n: number): ToolCall {
  const arg = (w: WindowArg): WindowArg => {
    const c = clampWindow(w, n);
    return { from: c.from, to: c.to };
  };
  switch (call.tool) {
    case "compare_windows":
      return { ...call, a: arg(call.a), b: arg(call.b) };
    case "test_relation":
    case "check_rule":
      return { ...call, window: arg(call.window) };
    default:
      return call;
  }
}

const span = (w: WindowArg): string => `[${w.from}, ${w.to})`;

export function describeCall(call: ToolCall): string {
  switch (call.tool) {
    case "compare_windows":
      return `compare_windows ${call.sensor} ${span(call.a)} against ${span(call.b)}`;
    case "test_relation":
      return `test_relation ${call.a} and ${call.b} in ${span(call.window)}`;
    case "find_changepoints":
      return `find_changepoints ${call.sensor} near ${call.near} span ${call.span}`;
    case "rerun_without":
      return `rerun_without ${call.sensor}`;
    case "test_role":
      return `test_role ${call.sensor} as ${call.role}`;
    case "check_rule":
      return `check_rule ${restateRule(call.rule)} in ${span(call.window)}`;
  }
}

export function outcome(inference: Inference, r: ToolResult, n: number, overrides: Overrides): { next: Outcome; changed: boolean } | null {
  const moved = (a: number | null, b: number | null): boolean => (a === null || b === null ? a !== b : Math.abs(a - b) > 0.01 * n);
  if (inference.stage === "role") {
    const role = r.role ?? r.result?.roles.find((x) => x.value.sensor === inference.sensor);
    if (!role) return null;
    const { hypothesisName, hypothesisConfidence } = inference.value;
    const forced = overrides.roles?.[inference.value.sensor] !== undefined;
    return { next: { ...role, value: { ...role.value, hypothesisName, hypothesisConfidence } }, changed: !forced && role.value.role !== inference.value.role };
  }
  if (inference.stage === "drift") {
    const drift = r.result?.drifts.find((x) => x.value.sensor === inference.sensor);
    return drift ? { next: drift, changed: drift.value.responsible !== inference.value.responsible || moved(drift.value.onset, inference.value.onset) } : null;
  }
  if (inference.stage === "diagnosis" && r.result) {
    const sensors = (v: DiagnosisValue): Set<string | null> => new Set([leadSensor(v), ...v.ranked.map((x) => x.sensor)]);
    const mine = sensors(inference.value);
    const incident = r.result.incidents
      .map((i) => ({ i, overlap: [...sensors(i.value)].filter((s) => mine.has(s)).length }))
      .filter((m) => m.overlap > 0)
      .sort((a, b) => b.overlap - a.overlap)[0]?.i;
    if (!incident) return null;
    const v = incident.value;
    return { next: incident, changed: v.faultClass !== inference.value.faultClass || moved(v.onset, inference.value.onset) };
  }
  return null;
}

export function changedPairs(before: Inference[], after: Inference[]): { before: Inference; after: Inference }[] {
  const key = (i: Inference): string => `${i.stage}|${i.sensor ?? ""}`;
  const shape = (i: Inference): string => JSON.stringify(i.value).replaceAll(`ev-${i.runId}-`, "ev-");
  const groups = new Map<string, Inference[]>();
  for (const i of after) groups.set(key(i), [...(groups.get(key(i)) ?? []), i]);
  return before.flatMap((b) => {
    const a = groups.get(key(b))?.shift();
    return a && shape(a) !== shape(b) ? [{ before: b, after: a }] : [];
  });
}
