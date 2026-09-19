import { describe, expect, it } from "vitest";
import { createSlackConnector, groupMessages, sourceForEvent, type SlackApi, type SlackMessage } from "../src/index";

const t = (seconds: number) => `${seconds}.000100`;
const messages: SlackMessage[] = [
  { ts: t(1000), user: "U1", text: "Dryer 3 valve sticks after a wash", reply_count: 1 },
  { ts: t(1100), thread_ts: t(1000), user: "U2", text: "Yes, xmv_6 lags by an hour", files: [{ name: "tags.csv", mimetype: "text/csv", url_private_download: "https://files.slack.com/tags.csv" }] },
  { ts: t(3000), user: "U1", text: "Separate note one" },
  { ts: t(3600), user: "U2", text: "Separate note two, within 30 minutes" },
  { ts: t(9000), user: "U1", text: "Much later" },
  { ts: t(9001), subtype: "channel_join", user: "U3", text: "joined" },
];

const api: SlackApi = {
  history: async () => ({ messages: messages.filter((m) => !m.thread_ts || m.thread_ts === m.ts), nextCursor: undefined }),
  replies: async (_channel, ts) => messages.filter((m) => m.ts === ts || m.thread_ts === ts),
  userName: async (user) => ({ U1: "Matti", U2: "Anna" })[user] ?? user,
  permalink: async (channel, ts) => `https://acme.slack.com/archives/${channel}/p${ts.replace(".", "")}`,
  download: async () => Buffer.from("tag;description\nxmv_6;Dryer valve\n"),
};

describe("slack connector", () => {
  it("makes one group per thread and groups loose messages under 30 minutes apart", () => {
    const groups = groupMessages(messages);
    expect(groups.map((g) => g.messages.length)).toEqual([2, 2, 1]);
    expect(groups[0]!.id).toBe(t(1000));
  });

  it("backfills a mapped channel into thread sources with a per-channel cursor", async () => {
    const connector = createSlackConnector(() => api);
    const items = [];
    for await (const item of connector.sync({ channels: { C1: "acme" }, appToken: null, backfillDays: 90 }, "xoxb-token", null, { transport: async () => { throw new Error("no http"); }, now: () => new Date(20000 * 1000), log: () => {} })) items.push(item);
    expect(items).toHaveLength(3);
    expect(items[0]!.source).toMatchObject({ kind: "slack_thread", externalId: `C1:${t(1000)}`, hint: { channelId: "C1" }, externalUrl: `https://acme.slack.com/archives/C1/p${t(1000).replace(".", "")}` });
    expect(items[0]!.source.attachments.map((a) => a.name)).toEqual(["tags.csv"]);
    expect(items[0]!.source.segments.map((s) => s.speaker)).toEqual(["Matti", "Anna"]);
    expect(items[0]!.source.segments[1]!.locator).toEqual({ kind: "slack_thread", channelId: "C1", ts: t(1100), threadTs: t(1000) });
    expect(JSON.parse(items[2]!.cursor!)).toEqual({ C1: t(9000) });
  });

  it("re-reads the whole thread on a change and marks a gone thread as deleted", async () => {
    const changed = await sourceForEvent(api, { type: "message", subtype: "message_changed", channel: "C1", message: { ts: t(1100), thread_ts: t(1000), text: "edited" } }, { transport: async () => { throw new Error("no"); }, now: () => new Date(), log: () => {} });
    expect(changed?.externalId).toBe(`C1:${t(1000)}`);
    expect(changed?.segments).toHaveLength(2);
    const gone = await sourceForEvent(api, { type: "message", subtype: "message_deleted", channel: "C1", deleted_ts: t(5555), previous_message: { ts: t(5555) } }, { transport: async () => { throw new Error("no"); }, now: () => new Date(), log: () => {} });
    expect(gone).toMatchObject({ externalId: `C1:${t(5555)}`, deleted: true });
  });
});
