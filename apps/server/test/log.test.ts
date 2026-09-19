import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LogEntry } from "@tpm/schemas";
import { appendLog, exportLog, genesisHash, verifyLog, type LogInput } from "../src/log";
import { fixture, run, type Fixture } from "./fixture";

const input = (runId: string, seq: number): LogInput => ({
  type: "inference",
  actor: "agent",
  runId,
  inferenceId: `inf-${runId}-${String(seq).padStart(5, "0")}`,
  evidenceIds: [`ev-${runId}-00001`],
  egressId: null,
  before: null,
  after: { role: "actuator" },
  reason: null,
});

describe("decision log", () => {
  let f: Fixture;
  beforeEach(() => {
    f = fixture();
    f.ctx.db.runs.save(run("0123abcd"));
  });
  afterEach(() => f.close());

  it("chains entries with sha256 and verifies the chain", () => {
    const first = appendLog(f.ctx.db, input("0123abcd", 1), "2026-09-19T10:00:00.000Z");
    const second = appendLog(f.ctx.db, input("0123abcd", 2), "2026-09-19T10:00:01.000Z");
    const third = appendLog(f.ctx.db, { ...input("0123abcd", 3), reason: 'a "quoted", reason' }, "2026-09-19T10:00:02.000Z");
    expect(first.prevHash).toBe(genesisHash);
    expect(second.prevHash).toBe(first.hash);
    expect(third.prevHash).toBe(second.hash);
    expect([first, second, third].map((e) => e.seq)).toEqual([1, 2, 3]);
    for (const entry of [first, second, third]) expect(LogEntry.parse(entry)).toEqual(entry);
    expect(verifyLog(f.ctx.db)).toEqual({ ok: true, entries: 3, firstBadSeq: null, head: third.hash });
  });

  it("fails verify at the tampered row", () => {
    for (let i = 1; i <= 3; i++) appendLog(f.ctx.db, input("0123abcd", i));
    const rows = f.ctx.db.log.list();
    const tampered = (rows[1]?.text ?? "").replace('"actuator"', '"setpoint"');
    f.ctx.db.raw.prepare("UPDATE log SET text = ? WHERE seq = 2").run(tampered);
    const result = verifyLog(f.ctx.db);
    expect(result.ok).toBe(false);
    expect(result.firstBadSeq).toBe(2);
    expect(result.entries).toBe(3);
    expect(result.head).toBe(rows[0]?.hash);
  });

  it("exports json and csv with a header and one row per entry", async () => {
    appendLog(f.ctx.db, input("0123abcd", 1));
    appendLog(f.ctx.db, { ...input("0123abcd", 2), reason: 'a "quoted", reason' });
    const csv = exportLog(f.ctx.db, "csv");
    const lines = csv.trimEnd().split("\r\n");
    expect(lines[0]).toBe("seq,time,type,actor,runId,inferenceId,evidenceIds,egressId,before,after,reason,prevHash,hash");
    expect(lines).toHaveLength(3);
    expect(lines[2]).toContain('"a ""quoted"", reason"');
    expect(JSON.parse(exportLog(f.ctx.db, "json"))).toHaveLength(2);
    const res = await f.app.request("/api/log/export?format=csv");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("decision-log.csv");
    expect(await res.text()).toBe(csv);
    const bad = await f.app.request("/api/log/export?format=xml");
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "format must be json or csv" });
  });

  it("lists by run and verifies over http", async () => {
    f.ctx.db.runs.save(run("89abcdef"));
    appendLog(f.ctx.db, input("0123abcd", 1));
    appendLog(f.ctx.db, input("89abcdef", 1));
    const all = (await (await f.app.request("/api/log")).json()) as LogEntry[];
    const one = (await (await f.app.request("/api/log?runId=89abcdef")).json()) as LogEntry[];
    expect(all.map((e) => e.seq)).toEqual([1, 2]);
    expect(one.map((e) => e.runId)).toEqual(["89abcdef"]);
    expect(await (await f.app.request("/api/log/verify")).json()).toMatchObject({ ok: true, entries: 2 });
  });
});
