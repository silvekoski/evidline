import { z } from "zod";
import { Alias, Window } from "./common.js";

export const EvidenceKind = z.enum([
  "correlation",
  "lag",
  "distribution",
  "trend",
  "changepoint",
  "residual",
  "health",
  "rule",
  "calibration",
  "structure",
]);
export type EvidenceKind = z.infer<typeof EvidenceKind>;

export const SeriesStyle = z.enum(["solid", "dashed", "thin", "dotted"]);

export const ChartSeries = z.object({
  key: z.string(),
  label: z.string(),
  source: z.union([z.object({ sensor: Alias }), z.object({ derived: z.string() })]),
  style: SeriesStyle,
});
export type ChartSeries = z.infer<typeof ChartSeries>;

export const ChartMark = z.object({
  at: z.number(),
  label: z.string(),
  kind: z.enum(["onset", "changepoint", "threshold", "boundary", "best-lag"]),
});
export type ChartMark = z.infer<typeof ChartMark>;

export const Histogram = z.object({
  label: z.string(),
  edges: z.array(z.number()).max(21),
  shares: z.array(z.number()).max(20),
});
export type Histogram = z.infer<typeof Histogram>;

export const ChartSpec = z.object({
  type: z.enum(["line", "histogram", "scatter", "bar", "lag"]),
  window: Window,
  series: z.array(ChartSeries),
  band: z.object({ lo: z.number(), hi: z.number(), label: z.string() }).optional(),
  marks: z.array(ChartMark).optional(),
  masks: z.array(Window).optional(),
  histograms: z.array(Histogram).optional(),
  bars: z.array(z.object({ label: z.string(), value: z.number() })).optional(),
  threshold: z.number().optional(),
  secondary: z.array(ChartSeries).optional(),
  lags: z.array(z.object({ lag: z.number().int(), rho: z.number() })).max(129).optional(),
});
export type ChartSpec = z.infer<typeof ChartSpec>;

export const Evidence = z.object({
  id: z.string(),
  runId: z.string(),
  kind: EvidenceKind,
  sensors: z.array(Alias),
  window: Window,
  method: z.string(),
  stats: z.record(z.string(), z.number()),
  verdict: z.string(),
  chart: ChartSpec,
});
export type Evidence = z.infer<typeof Evidence>;

export const EvidenceSeries = z.object({
  evidenceId: z.string(),
  t: z.array(z.number()),
  series: z.record(z.string(), z.array(z.number().nullable())),
});
export type EvidenceSeries = z.infer<typeof EvidenceSeries>;
