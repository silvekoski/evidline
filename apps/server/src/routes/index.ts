import { Hono } from "hono";
import type { AppContext } from "../context";
import { egressRoutes } from "./egress";
import { filesRoutes } from "./files";
import { logRoutes } from "./log";
import { settingsRoutes } from "./settings";

export function apiRoutes(ctx: AppContext) {
  return new Hono()
    .route("/files", filesRoutes(ctx))
    .route("/log", logRoutes(ctx))
    .route("/egress", egressRoutes(ctx))
    .route("/settings", settingsRoutes(ctx));
}
