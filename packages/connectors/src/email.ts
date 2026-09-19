import { z } from "zod";
import { htmlToText } from "html-to-text";
import { stripQuotedReplies, type SegmentDraft } from "@tpm/corpus";
import { graphAuth, graphClient } from "./graph";
import { emailDomain, type Connector, type RawAttachment, type RawSource, type SyncItem } from "./types";

export const EmailConfig = z.object({
  tenantId: z.string().min(1),
  clientId: z.string().min(1),
  mailbox: z.string().email(),
  folder: z.string().min(1).default("inbox"),
});
export type EmailConfig = z.infer<typeof EmailConfig>;

export type GraphMessage = {
  id: string;
  internetMessageId?: string;
  conversationId?: string;
  subject?: string | null;
  receivedDateTime: string;
  from?: { emailAddress?: { name?: string; address?: string } };
  toRecipients?: { emailAddress?: { address?: string } }[];
  ccRecipients?: { emailAddress?: { address?: string } }[];
  body?: { contentType: "text" | "html"; content: string };
  hasAttachments?: boolean;
  "@removed"?: { reason: string };
};

type GraphAttachment = { "@odata.type": string; name: string; contentType: string; contentBytes?: string; isInline?: boolean };

export const plusTag = (mailbox: string, addresses: string[]): string | null => {
  const [local, domain] = mailbox.toLowerCase().split("@");
  for (const address of addresses) {
    const m = /^([^+@]+)\+([^@]+)@(.+)$/.exec(address.toLowerCase());
    if (m && m[1] === local && m[3] === domain) return m[2]!;
  }
  return null;
};

export const messageText = (message: GraphMessage): string => {
  const body = message.body?.content ?? "";
  const text = message.body?.contentType === "html" ? htmlToText(body, { wordwrap: false, selectors: [{ selector: "a", options: { ignoreHref: true } }, { selector: "img", format: "skip" }] }) : body;
  return stripQuotedReplies(text);
};

export function threadSource(mailbox: string, messages: GraphMessage[], attachments: RawAttachment[]): RawSource | null {
  const ordered = [...messages].sort((a, b) => a.receivedDateTime.localeCompare(b.receivedDateTime));
  const first = ordered[0];
  if (!first) return null;
  const segments: SegmentDraft[] = ordered.flatMap((m, i) => {
    const text = messageText(m);
    if (!text) return [];
    const from = m.from?.emailAddress;
    return [{ text, speaker: from?.name || from?.address || null, block: i, locator: { kind: "email", messageId: m.internetMessageId ?? m.id, charStart: 0, charEnd: text.length } }];
  });
  const recipients = ordered.flatMap((m) => [...(m.toRecipients ?? []), ...(m.ccRecipients ?? [])].map((r) => r.emailAddress?.address ?? ""));
  const senders = ordered.map((m) => m.from?.emailAddress?.address ?? "").filter((a) => a && emailDomain(a) !== emailDomain(mailbox));
  const tag = plusTag(mailbox, recipients);
  return {
    kind: "email",
    externalId: first.conversationId ?? first.internetMessageId ?? first.id,
    title: first.subject || "(no subject)",
    occurredAt: ordered.at(-1)!.receivedDateTime,
    segments,
    attachments,
    hint: { ...(tag ? { plusTag: tag } : {}), domains: [...new Set(senders.map((a) => emailDomain(a)).filter((d): d is string => d !== null))] },
  };
}

export const emailConnector: Connector<EmailConfig> = {
  kind: "email",
  configSchema: EmailConfig,
  async *sync(config, secret, cursor, ctx): AsyncIterable<SyncItem> {
    const graph = graphClient(graphAuth(config, secret), ctx.transport, ctx.now);
    const user = encodeURIComponent(config.mailbox);
    const select = "$select=id,internetMessageId,conversationId,subject,receivedDateTime,from,toRecipients,ccRecipients,body,hasAttachments";
    const start = cursor ?? `/users/${user}/mailFolders/${config.folder}/messages/delta?${select}`;
    const changed = new Map<string, GraphMessage>();
    let deltaLink: string | null = null;
    for await (const page of graph.pages<GraphMessage>(start)) {
      for (const m of page.items) if (!m["@removed"]) changed.set(m.id, m);
      deltaLink = page.deltaLink ?? deltaLink;
    }
    const byConversation = new Map<string, GraphMessage[]>();
    for (const m of changed.values()) {
      const key = m.conversationId ?? m.id;
      byConversation.set(key, [...(byConversation.get(key) ?? []), m]);
    }
    for (const [conversationId, fresh] of byConversation) {
      const full = fresh[0]?.conversationId
        ? (await graph.get<{ value: GraphMessage[] }>(`/users/${user}/messages?$filter=conversationId eq '${conversationId.replace(/'/g, "''")}'&${select}&$top=50`)).value
        : fresh;
      const attachments: RawAttachment[] = [];
      for (const m of full.filter((x) => x.hasAttachments)) {
        const list = (await graph.get<{ value: GraphAttachment[] }>(`/users/${user}/messages/${m.id}/attachments`)).value;
        for (const a of list) if (a["@odata.type"] === "#microsoft.graph.fileAttachment" && a.contentBytes && !a.isInline) attachments.push({ name: a.name, mediaType: a.contentType, content: Buffer.from(a.contentBytes, "base64") });
      }
      const source = threadSource(config.mailbox, full.length ? full : fresh, attachments);
      if (source) yield { source, cursor: deltaLink };
    }
  },
};
