import { z } from "zod";
import { SocketModeClient } from "@slack/socket-mode";
import { WebClient } from "@slack/web-api";
import type { SegmentDraft } from "@tpm/corpus";
import type { Connector, RawSource, SyncContext, SyncItem } from "./types";

export const SlackConfig = z.object({
  channels: z.record(z.string(), z.string()),
  appToken: z.string().startsWith("xapp-").nullable().default(null),
  backfillDays: z.number().int().min(1).max(365).default(90),
});
export type SlackConfig = z.infer<typeof SlackConfig>;

export type SlackMessage = { ts: string; thread_ts?: string; user?: string; text?: string; subtype?: string; reply_count?: number; files?: { name?: string; mimetype?: string; url_private_download?: string }[] };

export type SlackApi = {
  history(channel: string, oldest: string | undefined, cursor: string | undefined): Promise<{ messages: SlackMessage[]; nextCursor: string | undefined }>;
  replies(channel: string, ts: string): Promise<SlackMessage[]>;
  userName(user: string): Promise<string>;
  permalink(channel: string, ts: string): Promise<string | null>;
};

export const GROUP_GAP_S = 30 * 60;

export function slackApi(botToken: string): SlackApi {
  const client = new WebClient(botToken);
  const names = new Map<string, string>();
  return {
    async history(channel, oldest, cursor) {
      const res = await client.conversations.history({ channel, limit: 200, inclusive: true, ...(oldest ? { oldest } : {}), ...(cursor ? { cursor } : {}) });
      return { messages: (res.messages ?? []) as SlackMessage[], nextCursor: res.response_metadata?.next_cursor || undefined };
    },
    async replies(channel, ts) {
      const out: SlackMessage[] = [];
      let cursor: string | undefined;
      do {
        const res = await client.conversations.replies({ channel, ts, limit: 200, ...(cursor ? { cursor } : {}) });
        out.push(...((res.messages ?? []) as SlackMessage[]));
        cursor = res.response_metadata?.next_cursor || undefined;
      } while (cursor);
      return out;
    },
    async userName(user) {
      const cached = names.get(user);
      if (cached) return cached;
      const res = await client.users.info({ user }).catch(() => null);
      const name = res?.user?.real_name || res?.user?.name || user;
      names.set(user, name);
      return name;
    },
    async permalink(channel, ts) {
      const res = await client.chat.getPermalink({ channel, message_ts: ts }).catch(() => null);
      return res?.permalink ?? null;
    },
  };
}

const isContent = (m: SlackMessage): boolean => !m.subtype || m.subtype === "thread_broadcast" || m.subtype === "file_share";
const tsToIso = (ts: string): string => new Date(Number(ts) * 1000).toISOString();

export function groupMessages(messages: SlackMessage[]): { id: string; messages: SlackMessage[] }[] {
  const sorted = [...messages].filter(isContent).sort((a, b) => Number(a.ts) - Number(b.ts));
  const groups: { id: string; messages: SlackMessage[] }[] = [];
  for (const m of sorted) {
    const threadRoot = m.thread_ts && m.thread_ts !== m.ts ? m.thread_ts : null;
    if (threadRoot) {
      const thread = groups.find((g) => g.id === threadRoot);
      if (thread) thread.messages.push(m);
      else groups.push({ id: threadRoot, messages: [m] });
      continue;
    }
    if (m.reply_count) {
      groups.push({ id: m.ts, messages: [m] });
      continue;
    }
    const last = groups.at(-1);
    const lastMessage = last?.messages.at(-1);
    if (last && lastMessage && !lastMessage.reply_count && !lastMessage.thread_ts && Number(m.ts) - Number(lastMessage.ts) <= GROUP_GAP_S) last.messages.push(m);
    else groups.push({ id: m.ts, messages: [m] });
  }
  return groups;
}

export async function threadSource(api: SlackApi, channel: string, group: { id: string; messages: SlackMessage[] }): Promise<RawSource> {
  const segments: SegmentDraft[] = [];
  for (const [i, m] of group.messages.entries()) {
    const text = (m.text ?? "").trim();
    if (!text) continue;
    segments.push({ text, speaker: m.user ? await api.userName(m.user) : null, block: i, locator: { kind: "slack_thread", channelId: channel, ts: m.ts, threadTs: m.thread_ts ?? null } });
  }
  const first = group.messages[0]!;
  return {
    kind: "slack_thread",
    externalId: `${channel}:${group.id}`,
    title: `#${channel} ${(first.text ?? "").slice(0, 60) || "thread"}`,
    occurredAt: tsToIso(first.ts),
    segments,
    attachments: [],
    hint: { channelId: channel },
  };
}

export type SlackApiFactory = (botToken: string) => SlackApi;

export function createSlackConnector(factory: SlackApiFactory = slackApi): Connector<SlackConfig> {
  return {
    kind: "slack",
    configSchema: SlackConfig,
    async *sync(config, secret, cursor, ctx): AsyncIterable<SyncItem> {
      if (!secret) throw new Error("the Slack connector has no bot token");
      const api = factory(secret);
      const cursors: Record<string, string> = cursor ? (JSON.parse(cursor) as Record<string, string>) : {};
      const fallback = String(Math.floor((ctx.now().getTime() - config.backfillDays * 86_400_000) / 1000));
      for (const channel of Object.keys(config.channels)) {
        const oldest = cursors[channel] ?? fallback;
        const all: SlackMessage[] = [];
        let page: string | undefined;
        do {
          const res = await api.history(channel, oldest, page);
          all.push(...res.messages);
          page = res.nextCursor;
        } while (page);
        const roots = all.filter((m) => m.reply_count);
        for (const root of roots) all.push(...(await api.replies(channel, root.ts)).filter((m) => m.ts !== root.ts));
        let newest = oldest;
        for (const group of groupMessages(all)) {
          for (const m of group.messages) if (Number(m.ts) > Number(newest)) newest = m.ts;
          cursors[channel] = newest;
          yield { source: await threadSource(api, channel, group), cursor: JSON.stringify(cursors) };
        }
        cursors[channel] = newest;
      }
    },
  };
}

export const slackConnector = createSlackConnector();

export type SlackEvent = { type: string; channel?: string; ts?: string; thread_ts?: string; subtype?: string; message?: SlackMessage; previous_message?: SlackMessage; deleted_ts?: string };

export async function sourceForEvent(api: SlackApi, event: SlackEvent, ctx: SyncContext): Promise<RawSource | null> {
  if (event.type !== "message" || !event.channel) return null;
  const channel = event.channel;
  const ts = event.subtype === "message_deleted" ? (event.previous_message?.thread_ts ?? event.deleted_ts) : event.subtype === "message_changed" ? (event.message?.thread_ts ?? event.message?.ts) : (event.thread_ts ?? event.ts);
  if (!ts) return null;
  const messages = await api.replies(channel, ts).catch(() => [] as SlackMessage[]);
  if (messages.length === 0) {
    ctx.log(`slack thread ${channel}:${ts} is gone`);
    return { kind: "slack_thread", externalId: `${channel}:${ts}`, title: "deleted", occurredAt: tsToIso(ts), segments: [], attachments: [], hint: { channelId: channel }, deleted: true };
  }
  return threadSource(api, channel, { id: ts, messages });
}

export async function startSocketMode(config: SlackConfig, onEvent: (event: SlackEvent) => Promise<void>, ctx: SyncContext): Promise<() => Promise<void>> {
  if (!config.appToken) throw new Error("Socket Mode needs an app token (xapp-...) in the config");
  const socket = new SocketModeClient({ appToken: config.appToken });
  socket.on("message", async ({ event, ack }: { event: SlackEvent; ack: () => Promise<void> }) => {
    await ack();
    try {
      await onEvent(event);
    } catch (e) {
      ctx.log(`slack event failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
  await socket.start();
  return () => socket.disconnect();
}
