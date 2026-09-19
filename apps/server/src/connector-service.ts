import { connectors, ensureSubscriptions, fetchTransport, meetingsWithoutTranscript, TeamsConfig, type MeetingGap, type RawSource, type SyncContext } from "@tpm/connectors";
import type { Connector as ConnectorRow, WorkspaceSlug } from "@tpm/schemas";
import type { AppContext } from "./context";
import { ingestRaw } from "./corpus-service";
import type { JobHandler, Resolve } from "./jobs";
import type { Registry } from "./registry";

export const syncIntervalMs: Record<string, number> = { teams: 10 * 60_000, email: 2 * 60_000, slack: 60 * 60_000 };
export const RENEW_INTERVAL_MS = 6 * 3600_000;

export const syncContext = (log: (line: string) => void): SyncContext => ({ transport: fetchTransport, now: () => new Date(), log });

export function routeSource(registry: Registry, connector: ConnectorRow, source: RawSource): { workspace: WorkspaceSlug | null; candidates: WorkspaceSlug[] } {
  if (connector.workspace) return { workspace: connector.workspace, candidates: [connector.workspace] };
  const { hint } = source;
  const channels = (connector.config.channels ?? {}) as Record<string, string>;
  if (hint.channelId && channels[hint.channelId] && registry.workspaces.get(channels[hint.channelId]!)) return { workspace: channels[hint.channelId]!, candidates: [channels[hint.channelId]!] };
  if (hint.plusTag && registry.workspaces.get(hint.plusTag)) return { workspace: hint.plusTag, candidates: [hint.plusTag] };
  const byDomain = [...new Set((hint.domains ?? []).flatMap((d) => registry.workspaces.byDomain(d).map((w) => w.slug)))];
  return { workspace: byDomain.length === 1 ? byDomain[0]! : null, candidates: byDomain };
}

export function deliver(registry: Registry, resolve: Resolve, connector: ConnectorRow, source: RawSource): WorkspaceSlug | null {
  const { workspace, candidates } = routeSource(registry, connector, source);
  if (!workspace) {
    registry.unassigned.put({ connectorId: connector.id, kind: source.kind, externalId: source.externalId, title: source.title, occurredAt: source.occurredAt, candidates }, source);
    return null;
  }
  const ctx = resolve(workspace);
  if (source.deleted) {
    const existing = ctx.corpus.sources.byExternalId(connector.id, source.externalId);
    if (existing) {
      ctx.corpus.chunks.deleteOfSource(existing.id);
      ctx.corpus.raw.prepare("UPDATE claim SET note = ? WHERE source_id = ?").run("The source message was deleted in Slack. The chunk and its vector are gone.", existing.id);
      ctx.corpus.sources.setStatus(existing.id, "failed", "deleted at the source");
    }
    return workspace;
  }
  ingestRaw(ctx, { kind: source.kind, connectorId: connector.id, externalId: source.externalId, title: source.title, occurredAt: source.occurredAt, segments: source.segments, attachments: source.attachments.map((a) => ({ name: a.name, mediaType: a.mediaType, content: a.content })), externalUrl: source.externalUrl ?? null });
  return workspace;
}

export function assignUnassigned(registry: Registry, resolve: Resolve, id: number, workspace: WorkspaceSlug): boolean {
  const row = registry.unassigned.raw(id);
  const connector = row ? registry.connectors.get(row.connectorId) : null;
  if (!row || !connector) return false;
  const source = row.raw as RawSource & { attachments: { name: string; mediaType: string; content: { data?: number[] } | Buffer }[] };
  const attachments = source.attachments.map((a) => ({ ...a, content: Buffer.isBuffer(a.content) ? a.content : Buffer.from((a.content as { data?: number[] }).data ?? []) }));
  deliver(registry, resolve, { ...connector, workspace }, { ...source, attachments });
  registry.unassigned.delete(id);
  return true;
}

export async function syncOnce(registry: Registry, resolve: Resolve, connector: ConnectorRow, log: (line: string) => void): Promise<{ sources: number; unassigned: number }> {
  const connectorImpl = connectors[connector.kind];
  if (!connectorImpl) return { sources: 0, unassigned: 0 };
  const config = connectorImpl.configSchema.parse(connector.config) as never;
  registry.connectors.update(connector.id, { status: "syncing" });
  let sources = 0;
  let unassigned = 0;
  try {
    for await (const item of connectorImpl.sync(config, registry.connectors.secret(connector.id), connector.cursor, syncContext(log))) {
      if (deliver(registry, resolve, connector, item.source) === null) unassigned++;
      else sources++;
      if (item.cursor) registry.connectors.update(connector.id, { cursor: item.cursor });
    }
    registry.connectors.update(connector.id, { status: "idle", lastSyncAt: new Date().toISOString(), lastError: null });
  } catch (e) {
    registry.connectors.update(connector.id, { status: "error", lastError: e instanceof Error ? e.message : String(e) });
    throw e;
  }
  return { sources, unassigned };
}

export const connectorSync: JobHandler = async (ctx, payload, _job, resolve) => {
  const id = payload.connectorId;
  if (typeof id !== "number") throw new Error("payload.connectorId is missing");
  const connector = ctx.registry.connectors.get(id);
  if (!connector) return;
  try {
    const result = await syncOnce(ctx.registry, resolve, connector, ctx.log);
    ctx.log(`connector ${connector.name}: ${result.sources} sources, ${result.unassigned} unassigned`);
  } finally {
    if (payload.recurring) scheduleSync(ctx.registry, connector, Date.now() + (syncIntervalMs[connector.kind] ?? 600_000));
  }
};

export function scheduleSync(registry: Registry, connector: ConnectorRow, at: number = Date.now()): void {
  if (connector.kind === "upload") return;
  registry.jobs.enqueue(null, "connector-sync", { connectorId: connector.id, recurring: true }, { runAfter: new Date(at).toISOString(), dedupe: `connector-sync-${connector.id}` });
}

export const renewSubscriptions: JobHandler = async (ctx) => {
  try {
    for (const connector of ctx.registry.connectors.list().filter((c) => c.kind === "teams")) {
      const config = TeamsConfig.safeParse(connector.config).data;
      if (!config?.notificationUrl) continue;
      try {
        const subs = await ensureSubscriptions(config, ctx.registry.connectors.secret(connector.id), syncContext(ctx.log));
        ctx.registry.connectors.update(connector.id, { lastError: null, config: { ...connector.config, subscriptions: subs } });
      } catch (e) {
        ctx.registry.connectors.update(connector.id, { status: "error", lastError: `subscription renewal failed: ${e instanceof Error ? e.message : String(e)}` });
      }
    }
  } finally {
    ctx.registry.jobs.enqueue(null, "renew-subscriptions", {}, { runAfter: new Date(Date.now() + RENEW_INTERVAL_MS).toISOString(), dedupe: "renew-subscriptions" });
  }
};

export async function handleGraphNotification(registry: Registry, resolve: Resolve, body: unknown, log: (line: string) => void): Promise<number> {
  let delivered = 0;
  for (const connector of registry.connectors.list().filter((c) => c.kind === "teams")) {
    const config = TeamsConfig.safeParse(connector.config).data;
    const impl = connectors.teams;
    if (!config || !impl?.handleWebhook) continue;
    const sources = await impl.handleWebhook(body, config as never, registry.connectors.secret(connector.id), syncContext(log));
    for (const source of sources) {
      deliver(registry, resolve, connector, source);
      delivered++;
    }
  }
  return delivered;
}

export async function transcriptGaps(ctx: AppContext, connector: ConnectorRow, days: number): Promise<MeetingGap[]> {
  const config = TeamsConfig.parse(connector.config);
  const domains = ctx.registry.workspaces.get(ctx.slug)?.domains ?? [];
  return meetingsWithoutTranscript(config, ctx.registry.connectors.secret(connector.id), domains, new Date(Date.now() - days * 86_400_000), syncContext(ctx.log));
}

export function startSchedules(registry: Registry): void {
  for (const connector of registry.connectors.list()) scheduleSync(registry, connector);
  registry.jobs.enqueue(null, "renew-subscriptions", {}, { dedupe: "renew-subscriptions" });
  registry.jobs.enqueue(null, "retention", {}, { dedupe: "retention" });
}
