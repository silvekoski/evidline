import { describe, expect, it } from "vitest";
import { emailConnector, plusTag } from "../src/index";
import { recordedTransport, token } from "./graph-fixture";

const config = { tenantId: "tenant", clientId: "client", mailbox: "corpus@norrin.example", folder: "inbox" };
const now = () => new Date("2026-09-19T12:00:00Z");

const mail = (id: string, received: string, text: string, extra: Record<string, unknown> = {}) => ({
  id,
  internetMessageId: `<${id}@acme.example>`,
  conversationId: "conv1",
  subject: "Re: Tag list",
  receivedDateTime: received,
  from: { emailAddress: { name: "Matti Virtanen", address: "matti@acme.example" } },
  toRecipients: [{ emailAddress: { address: "corpus+acme@norrin.example" } }],
  body: { contentType: "html", content: `<p>${text}</p><br><div>On Mon, Anna wrote:</div><blockquote>old text</blockquote>` },
  ...extra,
});

describe("email connector", () => {
  it("maps a plus address to a workspace tag", () => {
    expect(plusTag("corpus@norrin.example", ["Anna <a@x>", "corpus+acme@norrin.example"])).toBe("acme");
    expect(plusTag("corpus@norrin.example", ["corpus@norrin.example"])).toBeNull();
  });

  it("groups a thread into one source with one segment per email, strips quotes, and keeps the delta link", async () => {
    const transport = recordedTransport([
      token,
      { match: "/messages/delta?", body: { value: [mail("m2", "2026-09-19T10:00:00Z", "Second answer here.", { hasAttachments: true })], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/delta?token=next" } },
      { match: "conversationId eq 'conv1'", body: { value: [mail("m1", "2026-09-18T10:00:00Z", "xmeas_7 is the reactor pressure."), mail("m2", "2026-09-19T10:00:00Z", "Second answer here.", { hasAttachments: true })] } },
      { match: "/messages/m2/attachments", body: { value: [{ "@odata.type": "#microsoft.graph.fileAttachment", name: "tags.csv", contentType: "text/csv", contentBytes: Buffer.from("tag;description\nxmeas_7;Reactor pressure\n").toString("base64") }] } },
    ]);
    const items = [];
    for await (const item of emailConnector.sync(config, "secret", null, { transport, now, log: () => {} })) items.push(item);
    expect(items).toHaveLength(1);
    const { source, cursor } = items[0]!;
    expect(source).toMatchObject({ kind: "email", externalId: "conv1", title: "Re: Tag list", occurredAt: "2026-09-19T10:00:00Z", hint: { plusTag: "acme", domains: ["acme.example"] } });
    expect(source.segments.map((s) => s.text)).toEqual(["xmeas_7 is the reactor pressure.", "Second answer here."]);
    expect(source.segments[0]!.locator).toEqual({ kind: "email", messageId: "<m1@acme.example>", charStart: 0, charEnd: 32 });
    expect(source.attachments.map((a) => a.name)).toEqual(["tags.csv"]);
    expect(cursor).toBe("https://graph.microsoft.com/v1.0/delta?token=next");
  });

  it("starts from the delta link on the next sync", async () => {
    const transport = recordedTransport([token, { match: "delta?token=next", body: { value: [], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/delta?token=next2" } }]);
    const items = [];
    for await (const item of emailConnector.sync(config, "secret", "https://graph.microsoft.com/v1.0/delta?token=next", { transport, now, log: () => {} })) items.push(item);
    expect(items).toEqual([]);
    expect(transport.calls.some((c) => c.url.includes("token=next"))).toBe(true);
  });
});
