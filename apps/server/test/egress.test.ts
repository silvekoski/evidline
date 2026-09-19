import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EgressRecord, EgressTotals, Purpose, TemplateInfo } from "@tpm/schemas";
import { egressRecord, fixture, run, type Fixture } from "./fixture";

describe("egress routes", () => {
  let f: Fixture;
  beforeEach(() => {
    f = fixture();
    f.ctx.db.runs.save(run("0123abcd", { rawBytes: 5000 }));
    f.ctx.db.runs.save(run("89abcdef", { rawBytes: 700, createdAt: "2026-09-19T11:00:00.000Z" }));
    f.ctx.db.egress.save(egressRecord("eg-1", "0123abcd", "sent", { payloadBytes: 300, time: "2026-09-19T10:00:00.000Z" }));
    f.ctx.db.egress.save(egressRecord("eg-2", "0123abcd", "blocked", { payloadBytes: 200, time: "2026-09-19T10:00:01.000Z" }));
    f.ctx.db.egress.save(egressRecord("eg-3", "0123abcd", "off", { payloadBytes: 100, time: "2026-09-19T10:00:02.000Z" }));
    f.ctx.db.egress.save(egressRecord("eg-4", "89abcdef", "off", { payloadBytes: 50 }));
  });
  afterEach(() => f.close());

  it("totals three records: sent, blocked and off", async () => {
    const res = await f.app.request("/api/egress/totals?runId=0123abcd");
    expect(res.status).toBe(200);
    expect(EgressTotals.parse(await res.json())).toEqual({
      rawBytes: 5000,
      sentBytes: 300,
      calls: 3,
      sent: 1,
      blocked: 1,
      off: 1,
      scannerHits: 1,
      hosts: ["https://plant.openai.azure.com"],
    });
    const all = EgressTotals.parse(await (await f.app.request("/api/egress/totals")).json());
    expect(all).toMatchObject({ rawBytes: 5700, calls: 4, off: 2 });
  });

  it("lists records newest first with a run filter and returns one record", async () => {
    const list = (await (await f.app.request("/api/egress?runId=0123abcd")).json()) as EgressRecord[];
    expect(list.map((r) => r.id)).toEqual(["eg-3", "eg-2", "eg-1"]);
    for (const record of list) expect(EgressRecord.parse(record)).toEqual(record);
    expect(((await (await f.app.request("/api/egress")).json()) as EgressRecord[]).length).toBe(4);
    const one = await f.app.request("/api/egress/eg-2");
    expect(EgressRecord.parse(await one.json())).toMatchObject({ id: "eg-2", status: "blocked", operatorText: false });
    const missing = await f.app.request("/api/egress/eg-9");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "egress record not found" });
  });

  it("serves every template with a hash", async () => {
    const info = TemplateInfo.parse(await (await f.app.request("/api/egress/templates")).json());
    expect(Object.keys(info).sort()).toEqual([...Purpose.options].sort());
    expect(info.name_role.hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
