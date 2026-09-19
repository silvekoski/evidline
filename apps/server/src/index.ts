import { existsSync } from "node:fs";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { createContext } from "./context";
import { repoRoot } from "./paths";

const envFile = join(repoRoot, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const app = createApp(createContext());

serve({ fetch: app.fetch, port: 8787 }, (info) => console.log(`tpm server listens on http://localhost:${info.port}`));
