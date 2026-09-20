import { Hono } from "hono";
import type { AppContext } from "../context";
import { egressRoutes } from "./egress";
import { evidenceRoutes } from "./evidence";
import { filesRoutes } from "./files";
import { inferencesRoutes } from "./inferences";
import { knowledgeRoutes } from "./knowledge";
import { logRoutes } from "./log";
import { notificationRoutes } from "./notifications";
import { rulesRoutes } from "./rules";
import { runsRoutes } from "./runs";
import { settingsRoutes } from "./settings";

export function apiRoutes(ctx: AppContext) {
  return new Hono()
    .route("/files", filesRoutes(ctx))
    .route("/runs", runsRoutes(ctx))
    .route("/evidence", evidenceRoutes(ctx))
    .route("/inferences", inferencesRoutes(ctx))
    .route("/rules", rulesRoutes(ctx))
    .route("/log", logRoutes(ctx))
    .route("/notifications", notificationRoutes(ctx))
    .route("/egress", egressRoutes(ctx))
    .route("/settings", settingsRoutes(ctx))
    .route("/", knowledgeRoutes(ctx));
}
