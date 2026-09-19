import { slackApi, SlackConfig, sourceForEvent, startSocketMode } from "@tpm/connectors";
import { deliver, syncContext } from "./connector-service";
import type { WorkspaceManager } from "./workspaces";

export async function startSlackSockets(manager: WorkspaceManager): Promise<void> {
  const { registry } = manager;
  const resolve = (slug: string | null) => {
    const ws = manager.open(slug ?? "norrin");
    if (!ws) throw new Error(`workspace ${slug} does not exist`);
    return ws.ctx;
  };
  for (const connector of registry.connectors.list().filter((c) => c.kind === "slack")) {
    const config = SlackConfig.safeParse(connector.config).data;
    const token = registry.connectors.secret(connector.id);
    if (!config?.appToken || !token) continue;
    const ctx = syncContext(console.log);
    const api = slackApi(token);
    try {
      await startSocketMode(config, async (event) => {
        if (event.channel && !config.channels[event.channel]) return;
        const source = await sourceForEvent(api, event, ctx);
        if (source) deliver(registry, resolve, connector, source);
      }, ctx);
      console.log(`slack socket mode connected for ${connector.name}`);
    } catch (e) {
      registry.connectors.update(connector.id, { status: "error", lastError: `socket mode failed: ${e instanceof Error ? e.message : String(e)}` });
    }
  }
}
