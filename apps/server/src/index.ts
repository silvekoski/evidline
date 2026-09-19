import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { createContext } from "./context";

const app = createApp(createContext());

serve({ fetch: app.fetch, port: 8787 }, (info) => console.log(`tpm server listens on http://localhost:${info.port}`));
