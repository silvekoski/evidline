import { existsSync } from "node:fs";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { openRegistryAt } from "./context";
import { dataDir, repoRoot, webDist } from "./paths";
import { startSchedules } from "./connector-service";
import { createRootApp } from "./root-app";
import { startSlackSockets } from "./slack-live";
import { createWorkspaceManager, migrateLegacyDb } from "./workspaces";

const envFile = join(repoRoot, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const registry = openRegistryAt(dataDir, console.log);
migrateLegacyDb(dataDir, registry, console.log);
const manager = createWorkspaceManager({ dataDir, registry, webDist, log: console.log });
manager.runner.start();
startSchedules(registry);
void startSlackSockets(manager);
const app = createRootApp(manager, { webDist, log: console.log });

serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 8787) }, (info) => console.log(`tpm server listens on http://localhost:${info.port}`));
