import { z } from "zod";
import { Domain, TimeBase } from "./common.js";
import { Purpose } from "./egress.js";

export const StageStatus = z.enum(["pending", "running", "done", "failed", "skipped"]);

export const StageProgress = z.object({
  stage: z.number().int(),
  name: z.string(),
  status: StageStatus,
  ms: z.number().nullable(),
  counts: z.record(z.string(), z.number()),
});
export type StageProgress = z.infer<typeof StageProgress>;

export const stageNames = [
  "Source adapter",
  "Fingerprint",
  "Baseline",
  "Health calibration",
  "Health gate",
  "Rule proposals",
  "Relation graph",
  "Role scoring",
  "Drift calibration",
  "Drift detector",
  "Fault separation",
  "Model calls",
] as const;
export type StageName = (typeof stageNames)[number];

export const Run = z.object({
  id: z.string(),
  name: z.string(),
  domain: Domain,
  status: z.enum(["queued", "running", "done", "failed"]),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
  rows: z.number().int(),
  columns: z.number().int(),
  sensorCount: z.number().int(),
  quarantined: z.array(z.string()),
  episodes: z.number().int(),
  rawBytes: z.number(),
  gridSize: z.number().int(),
  bucket: z.number().int(),
  timeBase: TimeBase,
  commitHash: z.string(),
  templateHashes: z.record(Purpose, z.string()),
  stages: z.array(StageProgress),
  error: z.string().nullable(),
  parentRunId: z.string().nullable(),
});
export type Run = z.infer<typeof Run>;

export const RunEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("stage"), stage: StageProgress }),
  z.object({ type: z.literal("run"), run: Run }),
  z.object({ type: z.literal("done"), runId: z.string() }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);
export type RunEvent = z.infer<typeof RunEvent>;
