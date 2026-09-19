import { z } from "zod";
import { Alias, HealthClass, InferenceStatus, Role, SignalType } from "./common.js";

export const Quantiles = z.object({
  p1: z.number(),
  p5: z.number(),
  p25: z.number(),
  p50: z.number(),
  p75: z.number(),
  p95: z.number(),
  p99: z.number(),
});
export type Quantiles = z.infer<typeof Quantiles>;

export const Fingerprint = z.object({
  n: z.number().int(),
  missingRate: z.number(),
  quantiles: Quantiles,
  mad: z.number(),
  histogram: z.object({ edges: z.array(z.number()).max(21), shares: z.array(z.number()).max(20) }),
  step: z.number(),
  hold: z.number().int().positive(),
  noise: z.number(),
  acfTime: z.number(),
  period: z.number().nullable(),
  flatShare: z.number(),
  monotonicShare: z.number(),
  distinct: z.number().int(),
  signalType: SignalType,
});
export type Fingerprint = z.infer<typeof Fingerprint>;

export const Relation = z.object({
  a: Alias,
  b: Alias,
  rho: z.number(),
  lag: z.number().int(),
  rhoAtLag: z.number(),
  evidenceId: z.string(),
});
export type Relation = z.infer<typeof Relation>;

export const RedundancyGroup = z.object({ sensors: z.array(Alias).min(2), evidenceId: z.string() });
export type RedundancyGroup = z.infer<typeof RedundancyGroup>;

export const SensorRow = z.object({
  alias: Alias,
  sourceName: z.string(),
  index: z.number().int(),
  signalType: SignalType,
  role: Role,
  roleConfidence: z.number(),
  hypothesisName: z.string().nullable(),
  health: z.union([z.literal("healthy"), HealthClass]),
  status: InferenceStatus,
  roleInferenceId: z.string(),
  healthInferenceId: z.string(),
  driftInferenceId: z.string().nullable(),
  notes: z.array(z.string()),
  nameChecks: z.array(z.object({ model: z.string(), name: z.string().nullable(), agrees: z.boolean().nullable() })),
});
export type SensorRow = z.infer<typeof SensorRow>;

export const SensorDetail = SensorRow.extend({
  fingerprint: Fingerprint,
  roleScores: z.record(Role, z.number()),
  relations: z.array(Relation),
  redundancyGroup: z.array(Alias).nullable(),
  evidenceIds: z.array(z.string()),
});
export type SensorDetail = z.infer<typeof SensorDetail>;

export const SensorReport = z.object({
  runId: z.string(),
  sensors: z.array(SensorRow),
  redundancyGroups: z.array(RedundancyGroup),
  flowOrder: z.array(Alias),
});
export type SensorReport = z.infer<typeof SensorReport>;
