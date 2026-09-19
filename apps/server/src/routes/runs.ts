import { statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { CreateRunBody, SearchBody, type DriftReport, type IncidentReport, type Run, type SearchResponse, type SearchResult } from "@tpm/schemas";
import type { AppContext } from "../context";
import { runModelCalls } from "../model-calls";
import { driftReport, incidentReport, laneReport, qualityReport, sensorDetail, sensorReport } from "../reports";
import { badRequest, notFound, parseBody } from "../request";
import { startRun } from "../run-service";
import { registerModelCallsHook } from "../settings";
import { sseResponse } from "../sse";

export function runsRoutes(ctx: AppContext) {
  registerModelCallsHook((runId) => runModelCalls(ctx, runId));
  const runOf = (id: string): Run => {
    const run = ctx.db.runs.get(id);
    if (!run) throw notFound("run");
    return run;
  };
  return new Hono()
    .post("/", async (c) => {
      const { path } = await parseBody(c, CreateRunBody);
      const full = resolve(ctx.dataDir, path);
      const inside = relative(ctx.dataDir, full);
      if (inside === "" || inside.startsWith("..") || isAbsolute(inside)) throw badRequest("path must point to a file inside data/");
      if (!statSync(full, { throwIfNoEntry: false })?.isFile()) throw badRequest(`no file at data/${inside}`);
      return c.json({ runId: startRun(ctx, { path: full }).run.id }, 201);
    })
    .get("/", (c) => c.json(ctx.db.runs.list()))
    .get("/:id", (c) => c.json(runOf(c.req.param("id"))))
    .get("/:id/events", (c) => sseResponse(c, ctx.hub, runOf(c.req.param("id")).id))
    .get("/:id/sensors", (c) => c.json(sensorReport(ctx.db, runOf(c.req.param("id")))))
    .get("/:id/sensors/:alias", (c) => c.json(sensorDetail(ctx.db, runOf(c.req.param("id")), c.req.param("alias").toUpperCase())))
    .get("/:id/quality", (c) => c.json(qualityReport(ctx.db, runOf(c.req.param("id")))))
    .get("/:id/lanes", (c) => c.json(laneReport(ctx.db, runOf(c.req.param("id")))))
    .get("/:id/drift", (c) => {
      const run = runOf(c.req.param("id"));
      return c.json({ runId: run.id, drifts: driftReport(ctx.db, run) } satisfies DriftReport);
    })
    .get("/:id/incidents", (c) => {
      const run = runOf(c.req.param("id"));
      return c.json({ runId: run.id, incidents: incidentReport(ctx.db, run) } satisfies IncidentReport);
    })
    .post("/:id/search", async (c) => {
      const run = runOf(c.req.param("id"));
      const { text } = await parseBody(c, SearchBody);
      const payload = { purpose: "search" as const, query: text, domain: run.domain };
      const result = await ctx.gateway.call<SearchResponse>("search", payload, { runId: run.id, inferenceId: null, operatorText: true });
      if (!result.ok) throw new HTTPException(422, { message: result.reason });
      return c.json({ query: result.value, egressId: result.recordId } satisfies SearchResult);
    })
    .post("/:id/model-calls", async (c) => {
      const run = runOf(c.req.param("id"));
      if (run.status !== "done") throw new HTTPException(409, { message: `run ${run.id} is ${run.status}` });
      if (!(await runModelCalls(ctx, run.id))) throw new HTTPException(409, { message: `model calls for run ${run.id} are in flight` });
      return c.json({ runId: run.id });
    });
}
