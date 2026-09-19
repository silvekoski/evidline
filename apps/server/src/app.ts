import { existsSync } from "node:fs";
import { relative } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppContext } from "./context";
import { apiRoutes } from "./routes/index";

export function createApp(ctx: AppContext) {
  const app = new Hono();
  app.use(async (c, next) => {
    const started = performance.now();
    await next();
    ctx.log(`${c.req.method} ${c.req.path} ${c.res.status} ${Math.round(performance.now() - started)} ms`);
  });
  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
    console.error(err);
    return c.json({ error: err.message }, 500);
  });
  app.notFound((c) => c.json({ error: `${c.req.method} ${c.req.path} not found` }, 404));
  app.route("/api", apiRoutes(ctx));
  app.all("/api/*", (c) => c.notFound());
  if (ctx.webDist !== null && existsSync(ctx.webDist)) {
    const root = relative(process.cwd(), ctx.webDist);
    app.use("*", serveStatic({ root }));
    app.get("*", serveStatic({ root, path: "index.html" }));
  }
  return app;
}
