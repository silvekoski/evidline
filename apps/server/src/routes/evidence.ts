import { Hono } from "hono";
import { bucketMeans } from "@tpm/core";
import type { Evidence, EvidenceSeries } from "@tpm/schemas";
import type { AppContext } from "../context";
import { notFound } from "../request";

const maxPoints = 2000;

export function evidenceRoutes(ctx: AppContext) {
  const evidenceOf = (id: string): Evidence => {
    const evidence = ctx.db.evidence.get(id);
    if (!evidence) throw notFound("evidence");
    return evidence;
  };
  return new Hono()
    .get("/:id", (c) => c.json(evidenceOf(c.req.param("id"))))
    .get("/:id/series", (c) => {
      const evidence = evidenceOf(c.req.param("id"));
      const { from, to } = evidence.window;
      const bucket = Math.max(1, Math.ceil((to - from) / maxPoints));
      const derived = ctx.db.evidence.series(evidence.id);
      const series = Object.fromEntries(
        [...evidence.chart.series, ...(evidence.chart.secondary ?? [])].flatMap((s) => {
          const values = "sensor" in s.source ? ctx.db.grids.get(evidence.runId, s.source.sensor) : derived[s.source.derived];
          return values ? [[s.key, Array.from(bucketMeans(values.subarray(from, to), bucket), (v) => (Number.isFinite(v) ? v : null))]] : [];
        }),
      );
      const t = Array.from({ length: Math.ceil((to - from) / bucket) }, (_, b) => from + b * bucket);
      return c.json({ evidenceId: evidence.id, t, series } satisfies EvidenceSeries);
    });
}
