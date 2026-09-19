import { Hono } from "hono";
import type { EgressTotals } from "@tpm/schemas";
import type { AppContext } from "../context";
import type { Db } from "../db";
import { notFound, runIdQuery } from "../request";

export function egressTotals(db: Db, runId?: string): EgressTotals {
  const records = db.egress.list(runId);
  const runs = runId === undefined ? db.runs.list() : [db.runs.get(runId)].filter((run) => run !== null);
  const count = (status: "sent" | "blocked" | "off"): number => records.filter((r) => r.status === status).length;
  const left = records.filter((r) => r.status === "sent" || r.status === "error");
  return {
    rawBytes: runs.reduce((sum, run) => sum + run.rawBytes, 0),
    sentBytes: left.reduce((sum, r) => sum + r.payloadBytes, 0),
    calls: records.length,
    sent: count("sent"),
    blocked: count("blocked"),
    off: count("off"),
    scannerHits: records.filter((r) => r.guards.some((g) => (g.name === "leak" || g.name === "names") && !g.pass)).length,
    hosts: [...new Set(left.flatMap((r) => (r.provider ? [r.provider.host] : [])))],
  };
}

export function egressRoutes(ctx: AppContext) {
  return new Hono()
    .get("/", (c) => c.json(ctx.db.egress.list(runIdQuery(c))))
    .get("/totals", (c) => c.json(egressTotals(ctx.db, runIdQuery(c))))
    .get("/templates", (c) => c.json(ctx.gateway.templates()))
    .get("/:id", (c) => {
      const record = ctx.db.egress.get(c.req.param("id"));
      if (!record) throw notFound("egress record");
      return c.json(record);
    });
}
