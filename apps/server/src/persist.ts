import type { DiagnosisValue, Inference, Rule, Run } from "@tpm/schemas";
import type { Db, SensorRecord } from "./db";
import { inferenceId, newRuleId } from "./ids";
import { appendLog } from "./log";
import type { PipelineJobResult, PipelineOutput } from "./pipeline-worker";

type StageResult<V> = { value: V; claim: string; confidence: number; evidenceIds: string[] };
type ByStage<I = Inference> = I extends Inference ? I : never;
export type InferenceDraft<I = Inference> = I extends Inference ? Omit<I, "id" | "seq"> : never;

export const leadSensor = (value: DiagnosisValue): string | null => value.ranked[0]?.sensor ?? value.excluded[0] ?? null;

export function createInference(db: Db, draft: InferenceDraft): Inference {
  const seq = db.inferences.nextSeq(draft.runId);
  const inference = { ...draft, id: inferenceId(draft.runId, seq), seq } as Inference;
  db.inferences.save(inference);
  return inference;
}

export function inferencesOf(runId: string, result: PipelineOutput): Inference[] {
  const list: Inference[] = [];
  const add = <S extends Inference["stage"]>(stage: S, sensor: string | null, r: StageResult<ByStage<Extract<Inference, { stage: S }>>["value"]>): void => {
    const seq = list.length + 1;
    const inference = {
      id: inferenceId(runId, seq),
      runId,
      sensor,
      claim: r.claim,
      confidence: r.confidence,
      evidenceIds: r.evidenceIds,
      status: "proposed",
      supersedes: null,
      seq,
      stage,
      value: r.value,
    } as Inference;
    list.push(inference);
  };
  add("baseline", null, result.baseline);
  add("calibration", null, result.healthCalibration);
  for (const h of result.health) add("health", h.value.sensor, h);
  for (const r of result.rules) add("rule", r.value.rule.sensor, r);
  for (const r of result.roles) add("role", r.value.sensor, r);
  add("calibration", null, result.driftCalibration);
  for (const d of result.drifts) add("drift", d.value.sensor, d);
  for (const i of result.incidents) add("diagnosis", leadSensor(i.value), i);
  return list;
}

export function sensorRecords(runId: string, output: PipelineJobResult): SensorRecord[] {
  const { grid, sourceNames, result } = output;
  const flowIndex = new Map(result.graph.flowOrder.map((alias, i) => [alias, i]));
  return grid.aliases.map((alias, index) => ({
    runId,
    alias,
    index,
    sourceName: sourceNames[index] ?? alias,
    fingerprint: result.fingerprints[index]!,
    relations: result.graph.relations.filter((r) => r.a === alias || r.b === alias),
    redundancyGroup: result.graph.groups.find((g) => g.sensors.includes(alias)) ?? null,
    peers: result.graph.peers.get(alias) ?? [],
    flowIndex: flowIndex.get(alias) ?? null,
  }));
}

export function runWithSource(run: Run, output: PipelineJobResult): Run {
  const { grid, stats, t0 } = output;
  return {
    ...run,
    domain: stats.domain,
    rows: stats.rows,
    columns: stats.columns,
    sensorCount: grid.aliases.length,
    quarantined: stats.quarantined,
    episodes: stats.episodes,
    rawBytes: stats.rawBytes,
    gridSize: grid.n,
    bucket: stats.bucket,
    timeBase: { t0, dt: grid.dt, n: grid.n },
  };
}

export function persistRun(db: Db, run: Run, output: PipelineJobResult): { run: Run; inferences: Inference[]; rules: Rule[] } {
  const saved = runWithSource(run, output);
  const inferences = inferencesOf(run.id, output.result);
  const rules: Rule[] = inferences.flatMap((inference) =>
    inference.stage === "rule"
      ? [
          {
            id: newRuleId(),
            runId: run.id,
            rule: inference.value.rule,
            restated: inference.value.restated,
            violations: inference.value.violations,
            active: false,
            origin: "baseline" as const,
            inferenceId: inference.id,
            evidenceId: inference.evidenceIds[0]!,
          },
        ]
      : [],
  );
  db.transaction(() => {
    db.runs.save(saved);
    db.sensors.saveAll(sensorRecords(run.id, output));
    db.grids.save(run.id, output.grid);
    db.evidence.saveAll(output.evidence);
    for (const [id, derived] of output.derived) db.evidence.saveSeries(id, derived);
    db.inferences.saveAll(inferences);
    for (const rule of rules) db.rules.save(rule);
    const base = { actor: "agent" as const, runId: run.id, egressId: null, before: null, reason: null };
    for (const inference of inferences) {
      appendLog(db, { ...base, type: "evidence", inferenceId: inference.id, evidenceIds: inference.evidenceIds, after: null });
      appendLog(db, {
        ...base,
        type: "inference",
        inferenceId: inference.id,
        evidenceIds: inference.evidenceIds,
        after: { stage: inference.stage, sensor: inference.sensor, claim: inference.claim, confidence: inference.confidence, value: inference.value },
      });
    }
    for (const rule of rules) {
      appendLog(db, { ...base, type: "rule-compiled", inferenceId: rule.inferenceId, evidenceIds: [rule.evidenceId], after: { ruleId: rule.id, rule: rule.rule, restated: rule.restated, violations: rule.violations } });
    }
  });
  return { run: saved, inferences, rules };
}
