import { faultFamily, type Fingerprint, type Overrides, type StageName, type Thresholds } from "@tpm/schemas";
import { minBaselineLength, selectBaseline, snapToBoundary, type BaselineResult } from "./baseline";
import { calibrateDrift, type CalibrationResult } from "./calibrate-drift";
import { calibrateHealth, type HealthCalibrationResult } from "./calibrate-health";
import { detectDrift, type DriftResult } from "./drift";
import { separateFaults, type Incident } from "./faults";
import { fingerprint } from "./fingerprint";
import { defaultThresholds, healthGate, type HealthResult } from "./health";
import { relationGraph, type RelationGraph } from "./relations";
import { scoreRoles, type RoleResult } from "./roles";
import { proposeRules, type RuleResult } from "./rules";
import { createMemorySink, window, type EvidenceSink, type Grid, type Masks } from "./types";

export type StageCounts = Record<string, number>;

export type StageTiming = { name: StageName; ms: number; counts: StageCounts };

export type PipelineOptions = {
  seed?: number;
  overrides?: Overrides;
  onStage?: (name: StageName, ms: number, counts: StageCounts) => void;
};

export type PipelineResult = {
  fingerprints: Fingerprint[];
  baseline: BaselineResult;
  healthCalibration: HealthCalibrationResult;
  health: HealthResult[];
  masks: Masks;
  rules: RuleResult[];
  graph: RelationGraph;
  roles: RoleResult[];
  driftCalibration: CalibrationResult;
  drifts: DriftResult[];
  incidents: Incident[];
  thresholds: Thresholds;
  stages: StageTiming[];
};

const DEFAULT_SEED = 42;

function boundByHealth(grid: Grid, fps: Fingerprint[], found: BaselineResult, sink: EvidenceSink): BaselineResult {
  const { n } = grid;
  const end = found.value.window.to;
  const probe = createMemorySink("probe");
  const failures = healthGate(grid, found.value.window, fps, defaultThresholds, probe)
    .flatMap((h) => h.value.masked.filter((m) => m.to === n && m.from >= minBaselineLength(n) && m.from < end).map((m) => ({ h, from: m.from })))
    .sort((a, b) => a.from - b.from);
  const first = failures[0];
  if (!first) return found;
  const cut = snapToBoundary(grid.episodes, n, first.from);
  const { sensor, health } = first.h.value;
  const evidence = probe.evidence.find((e) => first.h.evidenceIds.includes(e.id) && e.method === health)!;
  const evidenceId = sink.add({ kind: evidence.kind, sensors: evidence.sensors, window: evidence.window, method: evidence.method, stats: evidence.stats, verdict: evidence.verdict, chart: evidence.chart });
  return {
    ...found,
    value: { ...found.value, window: window(0, cut) },
    claim: `Baseline is the first ${cut} samples. The change points alone gave the first ${end} samples, but ${sensor} fails the ${health} check from sample ${first.from} to the end of the grid, so the baseline ends before it${cut === first.from ? "" : `, at the episode boundary at sample ${cut}`}.`,
    evidenceIds: [...found.evidenceIds, evidenceId],
  };
}

function detectionCounts(value: CalibrationResult["value"]): StageCounts {
  return { faults: value.detection.length, detected: value.detection.filter((d) => d.detected).length };
}

export function runPipeline(grid: Grid, sink: EvidenceSink, options: PipelineOptions = {}): PipelineResult {
  const seed = options.seed ?? DEFAULT_SEED;
  const overrides = options.overrides ?? {};
  const stages: StageTiming[] = [];
  const stage = <T>(name: StageName, body: () => T, counts: (result: T) => StageCounts): T => {
    const started = Date.now();
    const result = body();
    const timing = { name, ms: Date.now() - started, counts: counts(result) };
    stages.push(timing);
    options.onStage?.(timing.name, timing.ms, timing.counts);
    return result;
  };

  const fingerprints = stage(
    "Fingerprint",
    () => grid.values.map((x) => fingerprint(x, grid.episodes)),
    (fps) => ({ sensors: fps.length, samples: grid.n, continuous: fps.filter((f) => f.signalType === "slow" || f.signalType === "fast").length }),
  );

  const baseline = stage(
    "Baseline",
    () => {
      const found = selectBaseline(grid, fingerprints, sink);
      const set = overrides.baseline;
      if (set) {
        const from = Math.max(0, Math.min(set.from, grid.n - 1));
        const w = window(from, Math.max(from + 1, Math.min(set.to, grid.n)));
        return { ...found, value: { ...found.value, window: w }, claim: `The operator set the baseline to samples ${w.from} to ${w.to}. ${found.claim}`, confidence: 1 };
      }
      return boundByHealth(grid, fingerprints, found, sink);
    },
    (b) => ({ samples: b.value.window.n, changepoints: b.value.changepoints.length }),
  );
  const baselineWindow = baseline.value.window;

  const healthCalibration = stage(
    "Health calibration",
    () => calibrateHealth(grid, baselineWindow, fingerprints, sink, seed),
    (c) => detectionCounts(c.value),
  );
  const healthThresholds: Thresholds = { ...defaultThresholds, ...healthCalibration.thresholds };

  const operatorMasked = new Set(overrides.masked ?? []);
  const health = stage(
    "Health gate",
    () => healthGate(grid, baselineWindow, fingerprints, healthThresholds, sink),
    (h) => ({ healthy: h.filter((r) => r.value.health === "healthy").length, failed: h.filter((r) => r.value.health !== "healthy").length, masked: operatorMasked.size }),
  );
  const masks: Masks = health.map((h, i) => (operatorMasked.has(grid.aliases[i]!) ? new Uint8Array(grid.n).fill(1) : h.mask));

  const rules = stage(
    "Rule proposals",
    () => proposeRules(grid, baselineWindow, fingerprints, healthThresholds, sink),
    (r) => ({ rules: r.length, violations: r.reduce((s, x) => s + x.value.violations, 0) }),
  );

  const graph = stage(
    "Relation graph",
    () => relationGraph(grid, masks, health, baselineWindow, fingerprints, healthThresholds, sink),
    (g) => ({ relations: g.relations.length, edges: g.relations.filter((r) => r.lag !== 0).length, groups: g.groups.length, ordered: g.flowOrder.length }),
  );

  const roles = stage(
    "Role scoring",
    () =>
      scoreRoles(grid, fingerprints, graph, baselineWindow, sink).map((r) => {
        const role = overrides.roles?.[r.value.sensor];
        if (role === undefined || role === r.value.role) return r;
        return { ...r, value: { ...r.value, role }, claim: `The operator set the role of ${r.value.sensor} to ${role}. ${r.claim}`, confidence: 1 };
      }),
    (r) => ({ assigned: r.filter((x) => x.value.role !== "unknown").length, unknown: r.filter((x) => x.value.role === "unknown").length }),
  );

  const driftCalibration = stage(
    "Drift calibration",
    () => calibrateDrift(grid, masks, graph, baselineWindow, fingerprints, sink, seed),
    (c) => detectionCounts(c.value),
  );
  const thresholds: Thresholds = { ...healthThresholds, ...driftCalibration.thresholds };

  const drifts = stage(
    "Drift detector",
    () => detectDrift(grid, masks, graph, roles, baselineWindow, fingerprints, thresholds, sink, overrides),
    (d) => ({ tested: d.length, drifting: d.filter((x) => x.value.drifting).length, responsible: d.filter((x) => x.value.responsible === x.value.sensor).length }),
  );

  const incidents = stage(
    "Fault separation",
    () =>
      separateFaults(
        {
          grid,
          masks,
          fps: fingerprints,
          baseline: baselineWindow,
          health,
          graph,
          roles,
          drifts,
          thresholds,
          changepoints: baseline.sensorChangepoints,
        },
        sink,
        overrides,
      ),
    (list) => ({
      incidents: list.length,
      sensor: list.filter((i) => faultFamily(i.value.faultClass) === "sensor").length,
      process: list.filter((i) => faultFamily(i.value.faultClass) === "process").length,
      data: list.filter((i) => faultFamily(i.value.faultClass) === "data").length,
    }),
  );

  return {
    fingerprints,
    baseline,
    healthCalibration,
    health,
    masks,
    rules,
    graph,
    roles,
    driftCalibration: { ...driftCalibration, value: { ...driftCalibration.value, thresholds } },
    drifts,
    incidents,
    thresholds,
    stages,
  };
}
