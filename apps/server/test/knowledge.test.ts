import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Claim, ColumnKnowledge, DataSpec, OpenQuestion, SearchHit, Source, Workspace } from "@tpm/schemas";
import { openRegistryAt } from "../src/context";
import { deliver } from "../src/connector-service";
import { applyRetention, extractForChunk } from "../src/corpus-service";
import { createRootApp } from "../src/root-app";
import { createWorkspaceManager, migrateLegacyDb } from "../src/workspaces";
import { fixture, type Fixture } from "./fixture";
import { pdf } from "../../../packages/corpus/test/fixtures";

const vtt = `WEBVTT

00:00:01.000 --> 00:00:04.000
<v Matti Virtanen>Kuivaimen 3 höyryventtiili PM2_DR3_STM_VLV_POS jumittuu pesun jälkeen.</v>

00:00:12.000 --> 00:00:15.000
<v Anna Data>So the valve position column lags the wash by one hour.</v>
`;
const notes = "# Reactor\n\nxmeas_7 is the reactor pressure in kPa gauge. We log it every 3 minutes.\n";
const sensorCsv = ["time,xmeas_7,xmeas_2", ...Array.from({ length: 40 }, (_, i) => `2026-01-01T00:0${i % 10}:00Z,${1000 + i * 1.25},${i * 7.5}`)].join("\n");

const form = (files: Record<string, string | Buffer>) => {
  const body = new FormData();
  for (const [name, content] of Object.entries(files)) body.append("files", new File([typeof content === "string" ? content : new Uint8Array(content)], name));
  return body;
};

let f: Fixture;
beforeEach(() => {
  f = fixture();
  f.ctx.corpus.columns.upsert({ name: "xmeas_7", alias: "S07", runId: "run00001", role: "controlled", signalType: "slow", hypothesis: null, confidence: 0.3, description: "xmeas_7 (S07) has the role controlled and a slow signal" });
  f.ctx.corpus.columns.upsert({ name: "PM2_DR3_STM_VLV_POS", alias: "S12", runId: "run00001", role: "actuator", signalType: "fast", hypothesis: "valve position", confidence: 0.9, description: "PM2_DR3_STM_VLV_POS (S12) is valve position and a fast signal" });
});
afterEach(() => f.close());

const upload = async (files: Record<string, string | Buffer>) => {
  const res = await f.app.request("/api/sources/upload", { method: "POST", body: form(files) });
  expect(res.status).toBe(201);
  return (await res.json()) as (Source & { created: boolean })[];
};
const drain = async () => {
  for (let i = 0; i < 8; i++) if ((await f.ctx.jobs.runPending()) === 0) break;
};
const search = async (query: string) => {
  const res = await f.app.request("/api/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query }) });
  expect(res.status).toBe(200);
  return (await res.json()) as SearchHit[];
};

describe("upload pipeline", () => {
  it("normalizes, chunks, embeds, and finds an uploaded transcript and a note", async () => {
    const sources = await upload({ "call.vtt": vtt, "notes.md": notes });
    expect(sources.map((s) => s.status)).toEqual(["received", "received"]);
    await drain();
    const list = (await (await f.app.request("/api/sources")).json()) as Source[];
    expect(list.map((s) => [s.kind, s.status, s.chunks > 0])).toEqual(expect.arrayContaining([["teams_call", "processed", true], ["file", "processed", true]]));
    const hits = await search("höyryventtiili jumittuu");
    expect(hits[0]).toMatchObject({ sourceKind: "teams_call", ftsRank: 1 });
    expect(hits.some((h) => h.kind === "passage" && h.sourceKind === "teams_call")).toBe(true);
    expect(hits[0]!.locator).toMatchObject({ kind: "teams_call", startMs: 1000 });
    const detail = (await (await f.app.request(`/api/sources/${hits[0]!.sourceId}`)).json()) as { segments: { speaker: string | null }[] };
    expect(detail.segments).toHaveLength(2);
    expect(detail.segments[0]!.speaker).toBe("Matti Virtanen");
  });

  it("makes no new source for a second upload of the same file", async () => {
    const first = await upload({ "notes.md": notes });
    const second = await upload({ "again.md": notes });
    expect(first[0]!.created).toBe(true);
    expect(second[0]).toMatchObject({ id: first[0]!.id, created: false });
    expect(f.ctx.corpus.sources.count()).toBe(1);
  });

  it("keeps sensor cell values out of every text that leaves", async () => {
    const seen: string[] = [];
    const inner = f.ctx.textGateway;
    f.ctx.textGateway = { ...inner, embed: (texts, kind) => (seen.push(...texts), inner.embed(texts, kind)), extract: (input) => (seen.push(input.chunk), inner.extract(input)) };
    const [source] = await upload({ "plant.csv": sensorCsv });
    await drain();
    const after = f.ctx.corpus.sources.get(source!.id)!;
    expect(after.status).toBe("sensor_data");
    expect(after.runId).not.toBeNull();
    expect(seen.length).toBeGreaterThan(0);
    for (const text of seen) {
      expect(text).not.toContain("1001.25");
      expect(text).not.toContain("7.5");
    }
    expect(f.ctx.corpus.egressLog.list().every((row) => !JSON.stringify(row).includes("1001.25"))).toBe(true);
  }, 60000);
});

describe("claims", () => {
  it("extracts claims with a verified quote, links them, and feeds the knowledge, open questions, and spec", async () => {
    await upload({ "call.vtt": vtt, "notes.md": notes });
    await drain();
    const claims = (await (await f.app.request("/api/claims")).json()) as Claim[];
    expect(claims.length).toBeGreaterThanOrEqual(2);
    for (const claim of claims) {
      expect(claim.quote.length).toBeGreaterThan(0);
      expect(claim.provenance).toBe("person");
      expect(claim.links.length).toBeGreaterThan(0);
    }
    const knowledge = (await (await f.app.request("/api/columns/xmeas_7/knowledge")).json()) as ColumnKnowledge;
    expect(knowledge.column.alias).toBe("S07");
    expect(knowledge.claims.length).toBeGreaterThanOrEqual(1);
    const claim = knowledge.claims[0]!;
    expect(claim.statement).toContain("reactor pressure");
    expect(claim.speaker).toBeNull();

    let questions = (await (await f.app.request("/api/open-questions")).json()) as OpenQuestion[];
    expect(questions.map((q) => q.column.name)).toEqual(["xmeas_7"]);

    const link = claim.links.find((l) => l.column === "xmeas_7")!;
    const confirmed = await f.app.request(`/api/claim-links/${link.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirmed: true }) });
    expect(confirmed.status).toBe(200);
    const patched = await f.app.request(`/api/claims/${claim.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "confirmed" }) });
    expect(((await patched.json()) as Claim).status).toBe("confirmed");

    questions = (await (await f.app.request("/api/open-questions")).json()) as OpenQuestion[];
    expect(questions).toEqual([]);
    const spec = (await (await f.app.request("/api/spec", { method: "POST" })).json()) as DataSpec;
    expect(spec.sentences).toEqual([{ column: "xmeas_7", text: claim.statement, claimIds: [claim.id] }]);
    expect(spec.columnsWithoutClaims).toEqual(["PM2_DR3_STM_VLV_POS"]);
  });

  it("transcribes an uploaded voice note into speaker turns and claims", async () => {
    f.ctx.textGateway = {
      ...f.ctx.textGateway,
      transcribe: async ({ mediaType }) => ({
        ok: true,
        source: "model",
        value: { language_code: "en", text: "", words: [
          { text: "xmeas_7", start: 0, end: 0.4, type: "word", speaker_id: "speaker_0" },
          { text: " ", start: 0.4, end: 0.5, type: "spacing", speaker_id: null },
          { text: `is the reactor pressure in kPa gauge (${mediaType}).`, start: 0.5, end: 2.0, type: "word", speaker_id: "speaker_0" },
        ] },
      }),
    };
    const [source] = await upload({ "answer.webm": "not really audio" });
    await drain();
    const after = f.ctx.corpus.sources.get(source!.id)!;
    expect(after).toMatchObject({ kind: "voice_note", status: "processed", segments: 1 });
    const detail = (await (await f.app.request(`/api/sources/${after.id}`)).json()) as { segments: { speaker: string | null; locator: { kind: string; endMs: number } }[] };
    expect(detail.segments[0]).toMatchObject({ speaker: "Speaker 0", locator: { kind: "teams_call", endMs: 2000 } });
    const claims = f.ctx.corpus.claims.ofSource(after.id);
    expect(claims.length).toBeGreaterThanOrEqual(1);
    expect(claims[0]!.statement).toContain("reactor pressure");
  });

  it("fails a voice note with a reason when the transcriber is off", async () => {
    const [source] = await upload({ "answer.m4a": "audio" });
    await drain();
    expect(f.ctx.corpus.sources.get(source!.id)).toMatchObject({ status: "failed", error: expect.stringContaining("model off") });
  });

  it("rejects a claim whose quote is not in the chunk", async () => {
    await upload({ "notes.md": notes });
    await drain();
    const chunkId = f.ctx.corpus.chunks.idsOfSource(1)[0]!;
    f.ctx.textGateway = { ...f.ctx.textGateway, extract: async () => ({ ok: true, source: "model", value: [{ statement: "Invented", quote: "the pump exploded", speaker: null, column: "xmeas_7", provenance: "model" }, { statement: "Pressure is logged every 3 minutes", quote: "We log it every 3 minutes", speaker: null, column: "xmeas_7", provenance: "person" }] }) };
    const result = await extractForChunk(f.ctx, chunkId);
    expect(result).toEqual({ accepted: 1, rejected: 1 });
    expect(f.ctx.corpus.counters.get("claims_rejected")).toBe(1);
    expect(f.ctx.corpus.claims.list().map((c) => c.statement)).toEqual(["Pressure is logged every 3 minutes"]);
  });
});

describe("workspaces", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "tpm-ws-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("routes by slug and keeps the data of two workspaces apart", async () => {
    const registry = openRegistryAt(dir, () => {});
    const manager = createWorkspaceManager({ dataDir: dir, registry, webDist: null, log: () => {} });
    const app = createRootApp(manager, { webDist: null, log: () => {} });
    for (const slug of ["acme", "beta"]) expect((await app.request("/api/workspaces", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug, name: slug, domains: [`${slug}.example`] }) })).status).toBe(201);
    expect(((await (await app.request("/api/workspaces")).json()) as Workspace[]).map((w) => w.slug)).toEqual(["acme", "beta"]);
    expect((await app.request("/api/w/acme/sources/upload", { method: "POST", body: form({ "notes.md": notes }) })).status).toBe(201);
    await manager.runner.runPending();
    const hitsA = (await (await app.request("/api/w/acme/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "reactor pressure" }) })).json()) as SearchHit[];
    const hitsB = (await (await app.request("/api/w/beta/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "reactor pressure" }) })).json()) as SearchHit[];
    expect(hitsA.length).toBeGreaterThan(0);
    expect(hitsB).toEqual([]);
    expect((await app.request("/api/w/nope/sources")).status).toBe(404);
    expect((await app.request("/api/w/acme/runs")).status).toBe(200);
    expect((await app.request("/api/workspaces/beta", { method: "DELETE" })).status).toBe(204);
    expect(existsSync(join(dir, "workspaces", "beta"))).toBe(false);
    manager.close();
    registry.close();
  });

  it("moves the legacy database into the norrin workspace once", () => {
    const legacy = join(dir, "tpm.db");
    mkdirSync(dir, { recursive: true });
    const db = new Database(legacy);
    db.exec("CREATE TABLE runs (id TEXT PRIMARY KEY); INSERT INTO runs VALUES ('abc')");
    db.close();
    writeFileSync(join(dir, "tpm.db-wal"), "");
    const registry = openRegistryAt(dir, () => {});
    migrateLegacyDb(dir, registry, () => {});
    const target = join(dir, "workspaces", "norrin", "tpm.db");
    expect(existsSync(target)).toBe(true);
    expect(existsSync(legacy)).toBe(false);
    expect(registry.workspaces.get("norrin")?.name).toBe("Norrin");
    const moved = new Database(target, { readonly: true });
    expect(moved.prepare("SELECT id FROM runs").all()).toEqual([{ id: "abc" }]);
    moved.close();
    migrateLegacyDb(dir, registry, () => {});
    registry.close();
  });
});

describe("connector routing", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "tpm-route-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("routes by plus tag, by a unique domain, and parks an ambiguous source as unassigned", async () => {
    const registry = openRegistryAt(dir, () => {});
    const manager = createWorkspaceManager({ dataDir: dir, registry, webDist: null, log: () => {} });
    const app = createRootApp(manager, { webDist: null, log: () => {} });
    manager.create({ slug: "acme", name: "Acme", domains: ["acme.example"] });
    manager.create({ slug: "beta", name: "Beta", domains: ["beta.example", "shared.example"] });
    manager.create({ slug: "gamma", name: "Gamma", domains: ["shared.example"] });
    const connector = registry.connectors.create({ kind: "email", name: "mailbox", workspace: null, config: {}, secret: null });
    const resolve = (slug: string | null) => manager.open(slug ?? "acme")!.ctx;
    const raw = (externalId: string, hint: Record<string, unknown>) => ({ kind: "email" as const, externalId, title: externalId, occurredAt: "2026-09-19T10:00:00Z", segments: [{ text: "xmeas_7 is the reactor pressure.", speaker: "Matti", block: 0, locator: { kind: "email" as const, messageId: externalId, charStart: 0, charEnd: 32 } }], attachments: [], hint });
    expect(deliver(registry, resolve, connector, raw("m1", { plusTag: "beta", domains: ["acme.example"] }))).toBe("beta");
    expect(deliver(registry, resolve, connector, raw("m2", { domains: ["acme.example"] }))).toBe("acme");
    expect(deliver(registry, resolve, connector, raw("m3", { domains: ["shared.example"] }))).toBeNull();
    expect(deliver(registry, resolve, connector, raw("m4", { domains: ["nobody.example"] }))).toBeNull();
    expect(manager.open("beta")!.ctx.corpus.sources.list().map((s) => s.externalId)).toEqual(["m1"]);
    expect(manager.open("acme")!.ctx.corpus.sources.list().map((s) => s.externalId)).toEqual(["m2"]);
    const unassigned = (await (await app.request("/api/unassigned")).json()) as { id: number; externalId: string; candidates: string[] }[];
    expect(unassigned.map((u) => [u.externalId, u.candidates])).toEqual([["m3", ["beta", "gamma"]], ["m4", []]]);
    const assign = await app.request(`/api/unassigned/${unassigned[0]!.id}/assign`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspace: "gamma" }) });
    expect(assign.status).toBe(204);
    expect(manager.open("gamma")!.ctx.corpus.sources.list().map((s) => s.externalId)).toEqual(["m3"]);
    expect(registry.unassigned.count()).toBe(1);
    const echo = await app.request("/api/webhooks/graph?validationToken=abc%20def", { method: "POST" });
    expect(echo.status).toBe(200);
    expect(await echo.text()).toBe("abc def");
    manager.close();
    registry.close();
  });
});

describe("retention", () => {
  it("removes sources older than the retention period and keeps the rest", async () => {
    await upload({ "old.md": notes, "new.md": `${notes}\nSecond file.` });
    await drain();
    const [older] = f.ctx.corpus.sources.list();
    f.ctx.corpus.sources.update(older!.id, { occurredAt: "2026-01-01T00:00:00.000Z" });
    expect(applyRetention(f.ctx, 30, Date.parse("2026-09-20T00:00:00Z"))).toBe(1);
    expect(f.ctx.corpus.sources.list().map((s) => s.id)).toEqual([f.ctx.corpus.sources.list()[0]!.id]);
    expect(f.ctx.corpus.sources.count()).toBe(1);
    expect(existsSync(join(f.ctx.dir, older!.blobPath!))).toBe(false);
  });
});

describe("erasure", () => {
  it("removes the words and claims of one person, drops the original file, and rebuilds the rest", async () => {
    const [source] = await upload({ "call.vtt": vtt });
    await drain();
    const before = f.ctx.corpus.claims.ofSource(source!.id);
    expect(before.some((c) => c.speaker === "Matti Virtanen")).toBe(true);
    const res = await f.app.request("/api/erasure", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ person: "matti virtanen" }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ segments: 1, sourcesRebuilt: 1, sourcesRemoved: 0, blobsRemoved: 1 });
    await drain();
    const after = f.ctx.corpus.sources.get(source!.id)!;
    expect(after.blobPath).toBeNull();
    expect(after.segments).toBe(1);
    expect(f.ctx.corpus.segments.list(after.id)[0]!.speaker).toBe("Anna Data");
    expect(f.ctx.corpus.claims.ofSource(after.id).every((c) => c.speaker !== "Matti Virtanen")).toBe(true);
    expect(f.ctx.corpus.raw.prepare("SELECT COUNT(*) AS n FROM chunk WHERE source_id = ? AND text LIKE '%Matti%'").get(after.id)).toEqual({ n: 0 });
    const hits = await search("Anna Data valve");
    expect(hits.length).toBeGreaterThan(0);
    const second = await f.app.request("/api/erasure", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ person: "Anna Data" }) });
    expect(await second.json()).toMatchObject({ sourcesRemoved: 1 });
    expect(f.ctx.corpus.sources.count()).toBe(0);
  });
});

describe("ocr", () => {
  it("reads a page without a text layer through the OCR reader and keeps page locators", async () => {
    const pages: number[] = [];
    f.ctx.textGateway = { ...f.ctx.textGateway, ocr: async ({ image, page }) => { pages.push(page); expect(image.subarray(1, 4).toString()).toBe("PNG"); return { ok: true, source: "model", value: `Scanned page ${page}: xmeas_7 is the reactor pressure.` }; } };
    const [source] = await upload({ "scan.pdf": pdf(["", "Typed page two has text.", ""]) });
    await drain();
    const after = f.ctx.corpus.sources.get(source!.id)!;
    expect(after.status).toBe("processed");
    expect(after).toMatchObject({ pages: 3, ocrPages: [1, 3] });
    expect(pages.sort()).toEqual([1, 3]);
    const segments = f.ctx.corpus.segments.list(after.id);
    expect(segments.map((s) => [s.locator.kind === "file" ? s.locator.page : null, s.text])).toEqual([[1, "Scanned page 1: xmeas_7 is the reactor pressure."], [2, "Typed page two has text."], [3, "Scanned page 3: xmeas_7 is the reactor pressure."]]);
  });

  it("keeps the status needs_ocr with the reason when OCR is off", async () => {
    const [source] = await upload({ "scan.pdf": pdf([""]) });
    await drain();
    expect(f.ctx.corpus.sources.get(source!.id)).toMatchObject({ status: "needs_ocr", pages: 1, ocrPages: [1], error: expect.stringContaining("model off") });
  });

  it("renders one page of a pdf source as a png and rejects a page past the end", async () => {
    const [source] = await upload({ "report.pdf": pdf(["Page one has text.", "Page two has text."]) });
    await drain();
    const res = await f.app.request(`/api/sources/${source!.id}/pages/2`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await res.arrayBuffer()).subarray(1, 4).toString()).toBe("PNG");
    expect((await f.app.request(`/api/sources/${source!.id}/pages/3`)).status).toBe(404);
  });
});
