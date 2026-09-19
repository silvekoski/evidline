import { existsSync } from "node:fs";
import { relative } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { AssignBody, CreateWorkspaceBody, WorkspaceSlug } from "@tpm/schemas";
import { assignUnassigned, handleGraphNotification } from "./connector-service";
import { badRequest, notFound, parseBody } from "./request";
import { uploadFiles } from "./routes/knowledge";
import type { WorkspaceManager } from "./workspaces";

export type RootOptions = { webDist: string | null; log: (line: string) => void };

export function createRootApp(manager: WorkspaceManager, opts: RootOptions) {
  const app = new Hono();
  app.use(async (c, next) => {
    const started = performance.now();
    await next();
    opts.log(`${c.req.method} ${c.req.path} ${c.res.status} ${Math.round(performance.now() - started)} ms`);
  });
  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
    console.error(err);
    return c.json({ error: err.message }, 500);
  });
  app.notFound((c) => c.json({ error: `${c.req.method} ${c.req.path} not found` }, 404));

  app.get("/api/workspaces", (c) => c.json(manager.list()));
  app.post("/api/workspaces", async (c) => {
    const body = await parseBody(c, CreateWorkspaceBody);
    if (manager.registry.workspaces.get(body.slug)) throw badRequest(`workspace ${body.slug} exists`);
    return c.json(manager.create(body), 201);
  });
  app.delete("/api/workspaces/:slug", (c) => {
    const slug = WorkspaceSlug.safeParse(c.req.param("slug")).data;
    if (!slug || !manager.remove(slug)) throw notFound("workspace");
    return c.body(null, 204);
  });
  app.post("/api/upload/:token", async (c) => {
    const slug = manager.registry.uploadLinks.resolve(c.req.param("token"));
    if (!slug) throw new HTTPException(403, { message: "the upload link is unknown or expired" });
    const ws = manager.open(slug);
    if (!ws) throw notFound("workspace");
    return c.json(await uploadFiles(ws.ctx, await c.req.parseBody({ all: true })), 201);
  });

  const resolve = (slug: string | null) => {
    const ws = manager.open(slug ?? "norrin");
    if (!ws) throw notFound(`workspace ${slug}`);
    return ws.ctx;
  };
  app.get("/api/unassigned", (c) => c.json(manager.registry.unassigned.list()));
  app.post("/api/unassigned/:id/assign", async (c) => {
    const { workspace } = await parseBody(c, AssignBody);
    if (!manager.registry.workspaces.get(workspace)) throw notFound(`workspace ${workspace}`);
    if (!assignUnassigned(manager.registry, resolve, Number(c.req.param("id")), workspace)) throw notFound("unassigned source");
    return c.body(null, 204);
  });
  app.delete("/api/unassigned/:id", (c) => {
    manager.registry.unassigned.delete(Number(c.req.param("id")));
    return c.body(null, 204);
  });
  const validation = (c: Context) => {
    const token = c.req.query("validationToken");
    return token === undefined ? null : c.text(token, 200, { "content-type": "text/plain" });
  };
  app.post("/api/webhooks/graph", async (c) => {
    const echo = validation(c);
    if (echo) return echo;
    const body = await c.req.json().catch(() => null);
    if (!body) throw badRequest("the notification has no JSON body");
    handleGraphNotification(manager.registry, resolve, body, opts.log).catch((e: unknown) => opts.log(`graph notification failed: ${e instanceof Error ? e.message : String(e)}`));
    return c.body(null, 202);
  });
  app.post("/api/webhooks/graph/lifecycle", async (c) => {
    const echo = validation(c);
    if (echo) return echo;
    manager.registry.jobs.enqueue(null, "renew-subscriptions", {}, { dedupe: "renew-subscriptions" });
    return c.body(null, 202);
  });

  app.all("/api/w/:workspace/*", (c) => {
    const slug = WorkspaceSlug.safeParse(c.req.param("workspace")).data;
    if (!slug) throw badRequest("bad workspace slug");
    const ws = manager.open(slug);
    if (!ws) throw notFound(`workspace ${slug}`);
    const url = new URL(c.req.url);
    url.pathname = `/api${url.pathname.slice(`/api/w/${slug}`.length)}`;
    const raw = c.req.raw;
    const init: RequestInit & { duplex?: "half" } = { method: raw.method, headers: raw.headers };
    if (raw.body) {
      init.body = raw.body;
      init.duplex = "half";
    }
    return ws.app.request(url.toString(), init);
  });
  app.all("/api/*", (c) => c.notFound());

  if (opts.webDist !== null && existsSync(opts.webDist)) {
    const root = relative(process.cwd(), opts.webDist);
    app.use("*", serveStatic({ root }));
    app.get("*", serveStatic({ root, path: "index.html" }));
  }
  return app;
}
