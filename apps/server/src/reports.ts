import { nameVote, type NameVote } from "./name-checks";
import type {
  BaselineInference,
  CalibrationInference,
  DiagnosisInference,
  DriftInference,
  HealthInference,
  Inference,
  LaneReport,
  QualityReport,
  RoleInference,
  Run,
  SensorDetail,
  SensorReport,
  SensorRow,
} from "@tpm/schemas";
import { bucketMeans, quantile } from "@tpm/core";
import type { Db, SensorRecord } from "./db";
import { notFound } from "./request";

const lanePoints = 240;

export const currentInferences = (db: Db, runId: string): Inference[] => db.inferences.list(runId).filter((i) => i.status !== "revised");

const ofStage = <S extends Inference["stage"]>(list: Inference[], stage: S): Extract<Inference, { stage: S }>[] =>
  list.filter((i): i is Extract<Inference, { stage: S }> => i.stage === stage);

function runFamily(db: Db, run: Run): Run[] {
  const chain: Run[] = [run];
  for (let parent = run.parentRunId; parent !== null && !chain.some((r) => r.id === parent); parent = chain.at(-1)!.parentRunId) {
    const r = db.runs.get(parent);
    if (!r) break;
    chain.push(r);
  }
  return [...new Map([...chain, ...db.runs.byName(run.name)].map((r) => [r.id, r])).values()];
}

function notesByAlias(db: Db, run: Run): Map<string, string[]> {
  const notes = runFamily(db, run).flatMap((r) =>
    db.inferences
      .list(r.id)
      .filter((i) => i.sensor !== null && i.status !== "proposed")
      .flatMap((i) =>
        db.threads
          .list(i.id)
          .filter((t) => t.kind === "question" || t.kind === "override")
          .map((t) => ({ alias: i.sensor!, time: t.time, note: `${t.time.slice(0, 10)} operator: ${t.text}` })),
      ),
  );
  notes.sort((a, b) => b.time.localeCompare(a.time));
  const byAlias = new Map<string, string[]>();
  for (const { alias, note } of notes) byAlias.set(alias, [...(byAlias.get(alias) ?? []), note]);
  return byAlias;
}

type RowContext = { roles: Map<string, RoleInference>; health: Map<string, HealthInference>; drifts: Map<string, DriftInference>; notes: Map<string, string[]>; vote: (role: RoleInference) => NameVote };

function rowContext(db: Db, run: Run): RowContext {
  const list = currentInferences(db, run.id);
  const bySensor = <I extends Inference>(items: I[]): Map<string, I> => new Map(items.map((i) => [i.sensor ?? "", i]));
  return { roles: bySensor(ofStage(list, "role")), health: bySensor(ofStage(list, "health")), drifts: bySensor(ofStage(list, "drift")), notes: notesByAlias(db, run), vote: (role) => nameVote(db, role) };
}

function sensorRow(sensor: SensorRecord, c: RowContext): SensorRow {
  const role = c.roles.get(sensor.alias);
  const health = c.health.get(sensor.alias);
  if (!role || !health) throw notFound(`inferences of ${sensor.alias}`);
  const vote = c.vote(role);
  return {
    alias: sensor.alias,
    sourceName: sensor.sourceName,
    index: sensor.index,
    signalType: sensor.fingerprint.signalType,
    role: role.value.role,
    roleConfidence: role.confidence,
    hypothesisName: vote.name ?? role.value.hypothesisName,
    health: health.value.health,
    status: role.status,
    roleInferenceId: role.id,
    healthInferenceId: health.id,
    driftInferenceId: c.drifts.get(sensor.alias)?.id ?? null,
    notes: c.notes.get(sensor.alias) ?? [],
    nameChecks: [...(vote.primary ? [vote.primary] : []), ...vote.checks].map(({ model, name, agrees }) => ({ model, name, agrees })),
  };
}

export function sensorReport(db: Db, run: Run): SensorReport {
  const sensors = db.sensors.list(run.id);
  const c = rowContext(db, run);
  return {
    runId: run.id,
    sensors: sensors.map((s) => sensorRow(s, c)),
    redundancyGroups: [...new Map(sensors.flatMap((s) => (s.redundancyGroup ? [[s.redundancyGroup.evidenceId, s.redundancyGroup] as const] : []))).values()],
    flowOrder: sensors.filter((s) => s.flowIndex !== null).sort((a, b) => a.flowIndex! - b.flowIndex!).map((s) => s.alias),
  };
}

export function sensorDetail(db: Db, run: Run, alias: string): SensorDetail {
  const sensor = db.sensors.get(run.id, alias);
  if (!sensor) throw notFound(`sensor ${alias}`);
  const c = rowContext(db, run);
  const row = sensorRow(sensor, c);
  return {
    ...row,
    fingerprint: sensor.fingerprint,
    roleScores: c.roles.get(alias)!.value.scores,
    relations: sensor.relations,
    redundancyGroup: sensor.redundancyGroup?.sensors ?? null,
    evidenceIds: [...new Set([...c.roles.get(alias)!.evidenceIds, ...db.evidence.relationsOf(run.id, alias).map((e) => e.id)])],
  };
}

export function qualityReport(db: Db, run: Run): QualityReport {
  const list = currentInferences(db, run.id);
  const baseline: BaselineInference | undefined = ofStage(list, "baseline").at(-1);
  if (!baseline) throw notFound("run results");
  const calibration: CalibrationInference[] = ofStage(list, "calibration");
  return { runId: run.id, baseline, calibration, checks: ofStage(list, "health"), rules: db.rules.list(run.id) };
}

export function laneReport(db: Db, run: Run): LaneReport {
  const baseline = ofStage(currentInferences(db, run.id), "baseline").at(-1);
  if (!baseline) throw notFound("run results");
  const { from, to } = baseline.value.window;
  const bucket = Math.max(1, Math.ceil(run.gridSize / lanePoints));
  const lanes = db.grids.series(run.id).map(({ alias, values }) => {
    const ref = values.subarray(from, to);
    const finite = ref.some((v) => Number.isFinite(v));
    return {
      sensor: alias,
      values: Array.from(bucketMeans(values, bucket), (v) => (Number.isFinite(v) ? v : null)),
      band: finite ? { lo: quantile(ref, 0.01), hi: quantile(ref, 0.99) } : null,
    };
  });
  const t = Array.from({ length: Math.ceil(run.gridSize / bucket) }, (_, b) => b * bucket);
  return { runId: run.id, t, bucket, lanes };
}

export const driftReport = (db: Db, run: Run): DriftInference[] => ofStage(currentInferences(db, run.id), "drift").sort((a, b) => b.value.severity - a.value.severity);

export const incidentReport = (db: Db, run: Run): DiagnosisInference[] =>
  ofStage(currentInferences(db, run.id), "diagnosis").sort((a, b) => (a.value.onset ?? run.gridSize) - (b.value.onset ?? run.gridSize));
