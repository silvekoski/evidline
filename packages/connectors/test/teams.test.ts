import { describe, expect, it } from "vitest";
import { ensureSubscriptions, teamsConnector } from "../src/index";
import { recordedTransport, token, vtt } from "./graph-fixture";

const config = { tenantId: "tenant", clientId: "client", organizers: ["anna@norrin.example"], notificationUrl: "https://tpm.norrin.example/api/webhooks/graph", clientState: "tpm-transcripts", lookbackDays: 7 };
const now = () => new Date("2026-09-19T12:00:00Z");

const recordings = [
  token,
  { match: "/users/anna%40norrin.example?$select=id", body: { id: "u1" } },
  { match: "/onlineMeetings/getAllTranscripts(", body: { value: [{ id: "tr1", meetingId: "m1", createdDateTime: "2026-09-18T10:00:00Z" }] } },
  { match: "/onlineMeetings/m1/transcripts/tr1/content?$format=text/vtt", body: vtt },
  { match: /\/onlineMeetings\/m1$/, body: { id: "m1", subject: "Dryer 3 review", startDateTime: "2026-09-18T09:00:00Z", participants: { organizer: { upn: "anna@norrin.example" }, attendees: [{ upn: "matti@acme.example" }] } } },
];

describe("teams connector", () => {
  it("downloads the vtt of each new transcript and hints the customer domains", async () => {
    const transport = recordedTransport(recordings);
    const items = [];
    for await (const item of teamsConnector.sync(config, "secret", null, { transport, now, log: () => {} })) items.push(item);
    expect(items).toHaveLength(1);
    const { source, cursor } = items[0]!;
    expect(source).toMatchObject({ kind: "teams_call", externalId: "m1:tr1", title: "Dryer 3 review", occurredAt: "2026-09-18T09:00:00Z", hint: { domains: ["norrin.example", "acme.example"] } });
    expect(source.segments).toHaveLength(2);
    expect(source.segments[0]!.locator).toEqual({ kind: "teams_call", startMs: 1000, endMs: 4000, speaker: "Matti Virtanen" });
    expect(cursor).toBe("2026-09-18T10:00:00Z");
    expect(transport.calls[0]!.url).toContain("/oauth2/v2.0/token");
    expect(transport.calls.some((c) => c.url.includes("startDateTime=2026-09-12T12:00:00.000Z"))).toBe(true);
  });

  it("reports the disabled-transcripts error with its inner code", async () => {
    const transport = recordedTransport([token, { match: "?$select=id", body: { id: "u1" } }, { match: "getAllTranscripts(", status: 403, body: { error: { code: "Forbidden", innerError: { code: "GraphAccessToTranscriptsDisabled" } } } }]);
    const run = async () => {
      for await (const _ of teamsConnector.sync(config, "secret", null, { transport, now, log: () => {} })) void _;
    };
    await expect(run()).rejects.toThrow("GraphAccessToTranscriptsDisabled");
  });

  it("answers a notification with the transcript and drops a wrong clientState", async () => {
    const transport = recordedTransport(recordings);
    const body = { value: [
      { subscriptionId: "s1", clientState: "tpm-transcripts", resource: "users('u1')/onlineMeetings('m1')/transcripts('tr1')" },
      { subscriptionId: "s1", clientState: "wrong", resource: "users('u1')/onlineMeetings('m1')/transcripts('tr1')" },
    ] };
    const sources = await teamsConnector.handleWebhook!(body, config, "secret", { transport, now, log: () => {} });
    expect(sources).toHaveLength(1);
    expect(sources[0]!.externalId).toBe("m1:tr1");
  });

  it("creates the two subscriptions per organizer with a lifecycle url and renews a near expiry", async () => {
    const transport = recordedTransport([
      token,
      { match: "?$select=id", body: { id: "u1" } },
      { match: /\/subscriptions$/, body: { value: [{ id: "old", resource: "users/u1/adhocCalls/getAllTranscripts", expirationDateTime: "2026-09-19T13:00:00Z" }] } },
      { match: "/subscriptions/old", body: "" },
    ]);
    const created: unknown[] = [];
    const posting = (async (url: string, init?: { method?: string | undefined; body?: string | undefined }) => {
      if (init?.method === "POST" && url.endsWith("/subscriptions")) {
        created.push(JSON.parse(init.body!));
        return { status: 201, headers: {}, text: JSON.stringify({ id: "new", ...JSON.parse(init.body!) }), bytes: async () => Buffer.alloc(0) };
      }
      return transport(url, init);
    }) as typeof transport;
    const subs = await ensureSubscriptions(config, "secret", { transport: posting, now, log: () => {} });
    expect(subs).toHaveLength(2);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ changeType: "created", resource: "users/u1/onlineMeetings/getAllTranscripts", lifecycleNotificationUrl: "https://tpm.norrin.example/api/webhooks/graph/lifecycle", clientState: "tpm-transcripts" });
    expect(transport.calls.some((c) => c.method === "PATCH" && c.url.endsWith("/subscriptions/old"))).toBe(true);
  });
});
