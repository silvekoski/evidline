import { z } from "zod";
import { Alias } from "./common.js";

const base = { sensor: Alias, source: z.string().max(500) };

export const RuleJson = z.discriminatedUnion("type", [
  z.object({ type: z.literal("range"), ...base, min: z.number().optional(), max: z.number().optional() }).strict(),
  z.object({ type: z.literal("flatline"), ...base, maxDuration: z.number().int().positive() }).strict(),
  z.object({ type: z.literal("rate"), ...base, maxRate: z.number().positive() }).strict(),
  z
    .object({
      type: z.literal("relation"),
      ...base,
      sensor2: Alias,
      relation: z.enum(["tracks", "leads", "equals"]),
      tolerance: z.number().nonnegative(),
      lag: z.number().int().optional(),
    })
    .strict(),
  z.object({ type: z.literal("missing"), ...base, maxMissingRate: z.number().min(0).max(1), windowSize: z.number().int().positive() }).strict(),
  z
    .object({
      type: z.literal("aggregate"),
      ...base,
      agg: z.enum(["mean", "median", "min", "max", "std"]),
      windowSize: z.number().int().positive(),
      min: z.number().optional(),
      max: z.number().optional(),
    })
    .strict(),
]).superRefine((r, ctx) => {
  if ((r.type === "range" || r.type === "aggregate") && r.min === undefined && r.max === undefined) {
    ctx.addIssue({ code: "custom", message: `${r.type} rule needs min or max` });
  }
});
export type RuleJson = z.infer<typeof RuleJson>;

export const Rule = z.object({
  id: z.string(),
  runId: z.string(),
  rule: RuleJson,
  restated: z.string(),
  violations: z.number().int(),
  active: z.boolean(),
  origin: z.enum(["baseline", "operator"]),
  inferenceId: z.string(),
  evidenceId: z.string(),
});
export type Rule = z.infer<typeof Rule>;
