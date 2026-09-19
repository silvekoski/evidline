import { z } from "zod";

export const LogType = z.enum([
  "run-started",
  "run-finished",
  "inference",
  "evidence",
  "model-call",
  "rule-compiled",
  "rule-activated",
  "accept",
  "question",
  "override",
  "rerun",
]);
export type LogType = z.infer<typeof LogType>;

export const LogEntry = z.object({
  seq: z.number().int(),
  time: z.string(),
  type: LogType,
  actor: z.enum(["agent", "operator"]),
  runId: z.string(),
  inferenceId: z.string().nullable(),
  evidenceIds: z.array(z.string()),
  egressId: z.string().nullable(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  reason: z.string().nullable(),
  prevHash: z.string(),
  hash: z.string(),
});
export type LogEntry = z.infer<typeof LogEntry>;

export const LogVerification = z.object({
  ok: z.boolean(),
  entries: z.number().int(),
  firstBadSeq: z.number().int().nullable(),
  head: z.string(),
});
export type LogVerification = z.infer<typeof LogVerification>;
