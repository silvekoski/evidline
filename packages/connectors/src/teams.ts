import { z } from "zod";
import { parseVtt, speakerTurns } from "@tpm/corpus";
import { graphAuth, graphClient, type GraphClient } from "./graph";
import { emailDomain, type Connector, type RawSource, type SyncContext, type SyncItem } from "./types";

export const TeamsConfig = z.object({
  tenantId: z.string().min(1),
  clientId: z.string().min(1),
  organizers: z.array(z.string().email()).min(1),
  notificationUrl: z.string().url().nullable().default(null),
  clientState: z.string().min(8).default("tpm-transcripts"),
  lookbackDays: z.number().int().min(1).max(90).default(7),
});
export type TeamsConfig = z.infer<typeof TeamsConfig>;

type Transcript = { id: string; meetingId: string; meetingOrganizerId?: string; createdDateTime: string; transcriptContentUrl?: string };
type Meeting = { id: string; subject?: string | null; startDateTime?: string; joinWebUrl?: string; participants?: { organizer?: { upn?: string }; attendees?: { upn?: string }[] } };
type User = { id: string };

const meetingDomains = (meeting: Meeting | null): string[] => {
  const people = [meeting?.participants?.organizer?.upn, ...(meeting?.participants?.attendees ?? []).map((a) => a.upn)];
  return [...new Set(people.flatMap((p) => (p ? [emailDomain(p)] : [])).filter((d): d is string => d !== null))];
};

export async function transcriptSource(graph: GraphClient, userId: string, transcript: Transcript, ctx: SyncContext): Promise<RawSource | null> {
  const base = `/users/${userId}/onlineMeetings/${transcript.meetingId}`;
  const vtt = (await graph.getRaw(`${base}/transcripts/${transcript.id}/content?$format=text/vtt`, "text/vtt")).toString("utf8");
  const segments = speakerTurns(parseVtt(vtt));
  if (segments.length === 0) {
    ctx.log(`transcript ${transcript.id} has no cues`);
    return null;
  }
  let meeting: Meeting | null = null;
  try {
    meeting = await graph.get<Meeting>(base);
  } catch (e) {
    ctx.log(`meeting ${transcript.meetingId} not readable: ${e instanceof Error ? e.message : String(e)}`);
  }
  return {
    kind: "teams_call",
    externalId: `${transcript.meetingId}:${transcript.id}`,
    title: meeting?.subject || `Teams call ${transcript.createdDateTime.slice(0, 16)}`,
    occurredAt: meeting?.startDateTime ?? transcript.createdDateTime,
    segments,
    attachments: [],
    hint: { domains: meetingDomains(meeting) },
    externalUrl: meeting?.joinWebUrl ?? null,
  };
}

const userId = async (graph: GraphClient, upn: string): Promise<string> => (await graph.get<User>(`/users/${encodeURIComponent(upn)}?$select=id`)).id;

export const teamsConnector: Connector<TeamsConfig> = {
  kind: "teams",
  configSchema: TeamsConfig,
  async *sync(config, secret, cursor, ctx): AsyncIterable<SyncItem> {
    const graph = graphClient(graphAuth(config, secret), ctx.transport, ctx.now);
    const end = ctx.now();
    const start = cursor ? new Date(cursor) : new Date(end.getTime() - config.lookbackDays * 86_400_000);
    let newest = start.toISOString();
    for (const organizer of config.organizers) {
      const id = await userId(graph, organizer);
      const path = `/users/${id}/onlineMeetings/getAllTranscripts(meetingOrganizerUserId='${id}',startDateTime=${start.toISOString()},endDateTime=${end.toISOString()})`;
      for await (const page of graph.pages<Transcript>(path)) {
        for (const transcript of page.items) {
          const source = await transcriptSource(graph, id, transcript, ctx);
          if (transcript.createdDateTime > newest) newest = transcript.createdDateTime;
          if (source) yield { source, cursor: newest };
        }
      }
    }
  },
  async handleWebhook(body, config, secret, ctx) {
    const notifications = z.object({ value: z.array(z.object({ clientState: z.string().optional(), resource: z.string(), subscriptionId: z.string() })) }).parse(body);
    const graph = graphClient(graphAuth(config, secret), ctx.transport, ctx.now);
    const out: RawSource[] = [];
    for (const n of notifications.value) {
      if (n.clientState !== config.clientState) {
        ctx.log(`notification ${n.subscriptionId} has a wrong clientState`);
        continue;
      }
      const m = /users\('([^']+)'\)\/onlineMeetings\('([^']+)'\)\/transcripts\('([^']+)'\)/.exec(n.resource);
      if (!m) continue;
      const source = await transcriptSource(graph, m[1]!, { id: m[3]!, meetingId: m[2]!, createdDateTime: ctx.now().toISOString() }, ctx);
      if (source) out.push(source);
    }
    return out;
  },
};

export type Subscription = { id: string; resource: string; expirationDateTime: string };

export const SUBSCRIPTION_MINUTES = 4200;

export async function ensureSubscriptions(config: TeamsConfig, secret: string | null, ctx: SyncContext): Promise<Subscription[]> {
  if (!config.notificationUrl) return [];
  const graph = graphClient(graphAuth(config, secret), ctx.transport, ctx.now);
  const existing = (await graph.get<{ value: Subscription[] }>("/subscriptions")).value;
  const out: Subscription[] = [];
  const expiration = new Date(ctx.now().getTime() + SUBSCRIPTION_MINUTES * 60_000).toISOString();
  for (const organizer of config.organizers) {
    const id = await userId(graph, organizer);
    for (const resource of [`users/${id}/onlineMeetings/getAllTranscripts`, `users/${id}/adhocCalls/getAllTranscripts`]) {
      const current = existing.find((s) => s.resource === resource);
      if (current) {
        if (new Date(current.expirationDateTime).getTime() - ctx.now().getTime() < 12 * 3600_000) await graph.patch(`/subscriptions/${current.id}`, { expirationDateTime: expiration });
        out.push({ ...current, expirationDateTime: expiration });
        continue;
      }
      out.push(
        await graph.post<Subscription>("/subscriptions", {
          changeType: "created",
          notificationUrl: config.notificationUrl,
          lifecycleNotificationUrl: `${config.notificationUrl}/lifecycle`,
          resource,
          expirationDateTime: expiration,
          clientState: config.clientState,
        }),
      );
    }
  }
  return out;
}

export type MeetingGap = { subject: string; start: string; organizer: string; domains: string[] };

export async function meetingsWithoutTranscript(config: TeamsConfig, secret: string | null, customerDomains: string[], since: Date, ctx: SyncContext): Promise<MeetingGap[]> {
  const graph = graphClient(graphAuth(config, secret), ctx.transport, ctx.now);
  const gaps: MeetingGap[] = [];
  const wanted = new Set(customerDomains.map((d) => d.toLowerCase()));
  for (const organizer of config.organizers) {
    const id = await userId(graph, organizer);
    const transcripts = new Set<string>();
    const path = `/users/${id}/onlineMeetings/getAllTranscripts(meetingOrganizerUserId='${id}',startDateTime=${since.toISOString()},endDateTime=${ctx.now().toISOString()})`;
    for await (const page of graph.pages<Transcript>(path)) for (const t of page.items) transcripts.add(t.meetingId);
    type Event = { subject?: string; start?: { dateTime: string }; attendees?: { emailAddress?: { address?: string } }[]; onlineMeeting?: { joinUrl?: string } | null };
    for await (const page of graph.pages<Event>(`/users/${id}/calendarView?startDateTime=${since.toISOString()}&endDateTime=${ctx.now().toISOString()}&$select=subject,start,attendees,onlineMeeting`)) {
      for (const event of page.items) {
        const domains = [...new Set((event.attendees ?? []).flatMap((a) => (a.emailAddress?.address ? [emailDomain(a.emailAddress.address)] : [])).filter((d): d is string => d !== null && wanted.has(d)))];
        if (domains.length === 0 || !event.onlineMeeting?.joinUrl) continue;
        const meeting = await graph.get<{ value: { id: string }[] }>(`/users/${id}/onlineMeetings?$filter=JoinWebUrl eq '${encodeURIComponent(event.onlineMeeting.joinUrl)}'`).catch(() => ({ value: [] }));
        if (meeting.value.some((m) => transcripts.has(m.id))) continue;
        gaps.push({ subject: event.subject ?? "(no subject)", start: event.start?.dateTime ?? "", organizer, domains });
      }
    }
  }
  return gaps;
}
