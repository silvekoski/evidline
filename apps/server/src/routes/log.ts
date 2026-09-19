import { Hono } from "hono";
import type { AppContext } from "../context";
import { badRequest, runIdQuery } from "../request";
import { exportLog, listLog, verifyLog } from "../log";

export function logRoutes(ctx: AppContext) {
  return new Hono()
    .get("/", (c) => c.json(listLog(ctx.db, runIdQuery(c))))
    .get("/verify", (c) => c.json(verifyLog(ctx.db)))
    .get("/export", (c) => {
      const format = c.req.query("format") ?? "json";
      if (format !== "json" && format !== "csv") throw badRequest("format must be json or csv");
      c.header("content-type", format === "json" ? "application/json; charset=utf-8" : "text/csv; charset=utf-8");
      c.header("content-disposition", `attachment; filename="decision-log.${format}"`);
      return c.body(exportLog(ctx.db, format));
    });
}
