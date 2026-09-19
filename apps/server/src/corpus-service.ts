import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { chunkSegments, extractClaimsLocally, fuseRanks, isAudioName, linkClaim, normalizeFile, openPdf, paragraphSegments, verifyQuote, wordsToTurns, type Normalized, type SegmentDraft } from "@tpm/corpus";
import type { AnswerBody, CatalogColumn, Claim, CorpusStats, DataSpec, ExtractedClaim, OpenQuestion, SearchHit, Source, SourceKind } from "@tpm/schemas";
import type { AppContext } from "./context";
import { columnCandidates, enqueueEmbeds } from "./catalog";
import type { JobHandler } from "./jobs";
import { startRun } from "./run-service";

export const SEARCH_CANDIDATES = 50;
export const LOW_CONFIDENCE = 0.5;

export type FileIngest = {
  name: string;
  mediaType: string;
  content: Buffer;
  connectorId?: number | null;
  externalId?: string;
  occurredAt?: string | null;
  parentSourceId?: number | null;
  externalUrl?: string | null;
};

export type RawIngest = {
  kind: SourceKind;
  connectorId: number | null;
  externalId: string;
  title: string;
  occurredAt: string;
  segments: SegmentDraft[];
  attachments?: FileIngest[];
  externalUrl?: string | null;
};

const sha256 = (buf: Buffer | string) => createHash("sha256").update(buf).digest("hex");
const mediaTypes: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".vtt": "text/vtt",
  ".eml": "message/rfc822",
  ".csv": "text/csv",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".webm": "audio/webm",
  ".flac": "audio/flac",
};
export const mediaTypeOf = (name: string): string => mediaTypes[extname(name).toLowerCase()] ?? "application/octet-stream";

export function ingestFile(ctx: AppContext, input: FileIngest): { source: Source; created: boolean } {
  const hash = sha256(input.content);
  const existing = ctx.corpus.sources.byHash(hash);
  if (existing) return { source: existing, created: false };
  const blob = join(ctx.blobDir, hash);
  if (!existsSync(blob)) writeFileSync(blob, input.content);
  const source = ctx.corpus.sources.insert({
    connectorId: input.connectorId ?? null,
    kind: "file",
    externalId: input.externalId ?? hash,
    title: input.name,
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    contentHash: hash,
    blobPath: relative(ctx.dir, blob),
    externalUrl: input.externalUrl ?? null,
    mediaType: input.mediaType && input.mediaType !== "application/octet-stream" ? input.mediaType : mediaTypeOf(input.name),
    bytes: input.content.byteLength,
    status: "received",
    error: null,
    runId: null,
    parentSourceId: input.parentSourceId ?? null,
  });
  ctx.jobs.enqueue("normalize", { sourceId: source.id });
  return { source, created: true };
}

export function ingestRaw(ctx: AppContext, raw: RawIngest): { source: Source; created: boolean; changed: boolean } {
  const hash = sha256(JSON.stringify(raw.segments.map((s) => [s.speaker, s.text])));
  const existing = ctx.corpus.sources.byExternalId(raw.connectorId, raw.externalId);
  if (existing && existing.contentHash === hash) return { source: existing, created: false, changed: false };
  const source =
    existing ??
    ctx.corpus.sources.insert({
      connectorId: raw.connectorId,
      kind: raw.kind,
      externalId: raw.externalId,
      title: raw.title,
      occurredAt: raw.occurredAt,
      contentHash: hash,
      blobPath: null,
      externalUrl: raw.externalUrl ?? null,
      mediaType: "text/plain",
      bytes: Buffer.byteLength(raw.segments.map((s) => s.text).join("\n")),
      status: "received",
      error: null,
      runId: null,
      parentSourceId: null,
    });
  if (existing) ctx.corpus.sources.update(source.id, { title: raw.title, occurredAt: raw.occurredAt, contentHash: hash, externalUrl: raw.externalUrl ?? null });
  ctx.corpus.segments.replace(source.id, raw.segments);
  for (const attachment of raw.attachments ?? []) ingestFile(ctx, { ...attachment, connectorId: raw.connectorId, parentSourceId: source.id });
  ctx.jobs.enqueue("chunk", { sourceId: source.id, previous: existing ? true : false });
  return { source: ctx.corpus.sources.get(source.id)!, created: !existing, changed: true };
}

const sourceId = (payload: Record<string, unknown>): number => {
  const id = payload.sourceId;
  if (typeof id !== "number") throw new Error("payload.sourceId is missing");
  return id;
};

const normalize: JobHandler = async (ctx, payload) => {
  const id = sourceId(payload);
  const source = ctx.corpus.sources.get(id);
  if (!source || !source.blobPath) throw new Error(`source ${id} has no blob`);
  ctx.corpus.sources.setStatus(id, "processing");
  try {
    const content = readFileSync(join(ctx.dir, source.blobPath));
    const result = isAudioName(source.title) ? await transcribeAudio(ctx, source, content) : await normalizeFile({ name: source.title, mediaType: source.mediaType, content, occurredAt: source.occurredAt });
    const ocr = result.ocrPages.length ? await readPages(ctx, content, result) : null;
    ctx.corpus.transaction(() => {
      ctx.corpus.segments.replace(id, result.segments);
      ctx.corpus.sources.setPages(id, result.pages, result.ocrPages);
      ctx.corpus.raw.prepare("UPDATE source SET kind = ?, title = ?, occurred_at = ? WHERE id = ?").run(result.kind, result.title, result.occurredAt ?? source.occurredAt, id);
    });
    for (const attachment of result.attachments) ingestFile(ctx, { ...attachment, connectorId: source.connectorId, parentSourceId: id });
    if (result.status === "needs_ocr" && ocr?.ok === false) {
      ctx.corpus.sources.setStatus(id, "needs_ocr", `${result.ocrPages.length} of the pages have no text layer, and OCR is not available: ${ocr.reason}`);
      return;
    }
    if (result.status === "sensor_data") {
      ctx.corpus.sources.setStatus(id, "sensor_data");
      ctx.jobs.enqueue("run-sensor-file", { sourceId: id });
    }
    ctx.jobs.enqueue("chunk", { sourceId: id });
  } catch (e) {
    ctx.corpus.sources.setStatus(id, "failed", e instanceof Error ? e.message : String(e));
    throw e;
  }
};

export const OCR_CONCURRENCY = 3;

async function readPages(ctx: AppContext, pdf: Buffer, result: Normalized): Promise<{ ok: boolean; reason: string }> {
  const doc = await openPdf(pdf);
  try {
    const texts = await mapLimit(result.ocrPages, OCR_CONCURRENCY, async (page) => ctx.textGateway.ocr({ image: await doc.render(page), mediaType: "image/png", page }));
    const failed = texts.find((t) => !t.ok);
    if (failed && !failed.ok) return { ok: false, reason: failed.reason };
    const read = result.ocrPages.flatMap((page, i) => {
      const text = texts[i]!;
      return text.ok ? paragraphSegments(text.value, { page, block: page }) : [];
    });
    result.segments = [...result.segments, ...read].sort((a, b) => pageOf(a) - pageOf(b) || charOf(a) - charOf(b));
    result.status = "processed";
    return { ok: true, reason: "" };
  } finally {
    await doc.close();
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const lane = async () => {
    for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i]!);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return out;
}

const pageOf = (s: SegmentDraft): number => (s.locator.kind === "file" ? (s.locator.page ?? 0) : 0);
const charOf = (s: SegmentDraft): number => (s.locator.kind === "file" ? s.locator.charStart : 0);

async function transcribeAudio(ctx: AppContext, source: Source, content: Buffer): Promise<Normalized> {
  const result = await ctx.textGateway.transcribe({ audio: content, mediaType: source.mediaType, language: process.env.TPM_TRANSCRIBE_LANGUAGE || null });
  if (!result.ok) throw new Error(`transcription failed: ${result.reason}`);
  const segments = wordsToTurns(result.value.words);
  return { title: source.title, kind: "voice_note", occurredAt: source.occurredAt, status: "processed", segments: segments.length ? segments : result.value.text.trim() ? [{ text: result.value.text.trim(), speaker: null, block: 0, locator: { kind: "teams_call", startMs: 0, endMs: 0, speaker: null } }] : [], headers: [], attachments: [], pages: null, ocrPages: [] };
}

const chunk: JobHandler = async (ctx, payload) => {
  const id = sourceId(payload);
  const source = ctx.corpus.sources.get(id);
  if (!source) throw new Error(`source ${id} not found`);
  const segments = ctx.corpus.segments.list(id);
  const drafts = chunkSegments(source.kind, segments);
  const keepClaims = payload.extract === false;
  const { chunkIds, claimChunkIds } = ctx.corpus.transaction(() => {
    for (const claim of ctx.corpus.claims.ofSource(id)) if (payload.previous) ctx.corpus.claims.setStatus(claim.id, "contradicted", "The source changed and the quote was not found again.");
    ctx.corpus.chunks.deleteOfSource(id);
    const chunkIds = drafts.map((d) => ctx.corpus.chunks.insert({ sourceId: id, kind: "passage", text: d.text, locator: d.locator, tokens: d.tokens, segmentFrom: d.segmentFrom, segmentTo: d.segmentTo }));
    const claimChunkIds = keepClaims
      ? ctx.corpus.claims.ofSource(id).map((c) => ctx.corpus.chunks.insert({ sourceId: id, kind: "claim", text: c.statement, locator: c.locator, tokens: Math.ceil(c.statement.length / 4), segmentFrom: null, segmentTo: null, claimId: c.id }))
      : [];
    return { chunkIds, claimChunkIds };
  });
  enqueueEmbeds(ctx, [...chunkIds, ...claimChunkIds]);
  if (!keepClaims) for (const chunkId of chunkIds) ctx.jobs.enqueue("extract", { chunkId });
  if (source.status !== "sensor_data") ctx.corpus.sources.setStatus(id, "processed");
};

function ensureEmbeddingMeta(ctx: AppContext): void {
  const current = ctx.textGateway.embedder();
  const stored = ctx.corpus.embeddingMeta.get();
  if (stored && stored.name === current.name && stored.model === current.model && stored.dims === current.dims) return;
  ctx.corpus.embeddingMeta.set({ name: current.name, model: current.model, dims: current.dims });
  if (stored) {
    ctx.log(`embedder changed from ${stored.model} to ${current.model}: all chunks embed again`);
    ctx.corpus.chunks.clearVectors();
    enqueueEmbeds(ctx, ctx.corpus.chunks.unembeddedIds());
  }
}

const embed: JobHandler = async (ctx, payload) => {
  ensureEmbeddingMeta(ctx);
  const ids = (payload.chunkIds as number[] | undefined) ?? [];
  const rows = ctx.corpus.chunks.texts(ids);
  if (rows.length === 0) return;
  const result = await ctx.textGateway.embed(rows.map((r) => r.text), "passage");
  if (!result.ok) throw new Error(result.reason);
  rows.forEach((row, i) => ctx.corpus.chunks.setVector(row.id, result.value[i]!));
  let columnChanged = false;
  for (const row of rows) {
    const chunk = ctx.corpus.raw.prepare("SELECT kind, claim_id FROM chunk WHERE id = ?").get(row.id) as { kind: string; claim_id: number | null } | undefined;
    if (chunk?.kind === "column") columnChanged = true;
    if (chunk?.kind === "claim" && chunk.claim_id) ctx.jobs.enqueue("link", { claimId: chunk.claim_id }, { dedupe: `link-${chunk.claim_id}` });
  }
  if (columnChanged) for (const claim of ctx.corpus.claims.list()) ctx.jobs.enqueue("link", { claimId: claim.id }, { dedupe: `link-${claim.id}` });
};

const promptColumns = (columns: ReturnType<typeof columnCandidates>): string[] =>
  columns.slice(0, 120).map((c) => `${c.name} (${c.alias})${c.hypothesis ? `: ${c.hypothesis}` : ""}${c.phrases.length ? ` also called ${c.phrases.join(", ")}` : ""}`);

function chunkSpeaker(ctx: AppContext, chunk: Chunk): string | null {
  if (chunk.locator.kind === "teams_call" && chunk.locator.speaker) return chunk.locator.speaker;
  if (chunk.sourceId === null || chunk.segmentFrom === null || chunk.segmentTo === null) return null;
  const speakers = new Set(ctx.corpus.segments.list(chunk.sourceId).slice(chunk.segmentFrom, chunk.segmentTo + 1).map((s) => s.speaker));
  return speakers.size === 1 ? ([...speakers][0] ?? null) : null;
}

export async function extractForChunk(ctx: AppContext, chunkId: number): Promise<{ accepted: number; rejected: number }> {
  const chunk = ctx.corpus.chunks.get(chunkId);
  if (!chunk || chunk.sourceId === null) throw new Error(`chunk ${chunkId} not found`);
  const source = ctx.corpus.sources.get(chunk.sourceId);
  if (!source) throw new Error(`source ${chunk.sourceId} not found`);
  const columns = columnCandidates(ctx.corpus);
  const speaker = chunkSpeaker(ctx, chunk);
  const result = await ctx.textGateway.extract({ chunk: chunk.text, columns: promptColumns(columns), speaker });
  let claims: ExtractedClaim[];
  let provenanceSource: "model" | "local";
  if (result.ok) {
    claims = result.value;
    provenanceSource = "model";
  } else if (result.reason === "model off" || result.reason.startsWith("no provider")) {
    claims = extractClaimsLocally(chunk.text, speaker, columns);
    provenanceSource = "local";
  } else throw new Error(result.reason);
  const fuzzy = source.kind === "teams_call" || source.kind === "voice_note";
  let accepted = 0;
  let rejected = 0;
  const newChunkIds: number[] = [];
  ctx.corpus.transaction(() => {
    for (const old of ctx.corpus.claims.ofChunk(chunkId)) ctx.corpus.raw.prepare("DELETE FROM claim WHERE id = ?").run(old.id);
    ctx.corpus.raw.prepare("DELETE FROM chunk WHERE kind = 'claim' AND source_id = ? AND claim_id IS NULL").run(source.id);
    for (const claim of claims) {
      const check = verifyQuote(claim.quote, chunk.text, fuzzy);
      if (!check.ok) {
        rejected++;
        continue;
      }
      const named = claim.column && columns.find((c) => c.name === claim.column || c.alias === claim.column);
      const claimId = ctx.corpus.claims.insert({
        chunkId,
        sourceId: source.id,
        statement: claim.statement,
        quote: claim.quote,
        speaker: claim.speaker ?? speaker,
        occurredAt: source.occurredAt,
        provenance: claim.provenance,
        status: claim.provenance === "person" && provenanceSource === "local" ? "stated" : "hypothesis",
        locator: chunk.locator,
        namedColumn: named ? named.name : null,
      });
      newChunkIds.push(ctx.corpus.chunks.insert({ sourceId: source.id, kind: "claim", text: claim.statement, locator: chunk.locator, tokens: Math.ceil(claim.statement.length / 4), segmentFrom: chunk.segmentFrom, segmentTo: chunk.segmentTo, claimId }));
      accepted++;
    }
    ctx.corpus.counters.add("claims_accepted", accepted);
    ctx.corpus.counters.add("claims_rejected", rejected);
  });
  enqueueEmbeds(ctx, newChunkIds);
  return { accepted, rejected };
}

const extract: JobHandler = async (ctx, payload) => {
  const chunkId = payload.chunkId;
  if (typeof chunkId !== "number") throw new Error("payload.chunkId is missing");
  await extractForChunk(ctx, chunkId);
};

export function linkOne(ctx: AppContext, claimId: number): void {
  const claim = ctx.corpus.claims.get(claimId);
  if (!claim) return;
  const vector = claim.chunkId ? ctx.corpus.chunks.vector(claimChunkId(ctx, claimId) ?? -1) : null;
  const candidates = linkClaim(claim.statement, vector, ctx.corpus.claims.namedColumn(claimId), ctx.corpus.columns.vectors());
  ctx.corpus.links.replace(claimId, candidates);
}

const claimChunkId = (ctx: AppContext, claimId: number): number | null =>
  (ctx.corpus.raw.prepare("SELECT id FROM chunk WHERE kind = 'claim' AND claim_id = ?").get(claimId) as { id: number } | undefined)?.id ?? null;

const link: JobHandler = async (ctx, payload) => {
  const claimId = payload.claimId;
  if (typeof claimId !== "number") throw new Error("payload.claimId is missing");
  linkOne(ctx, claimId);
};

const runSensorFile: JobHandler = async (ctx, payload) => {
  const id = sourceId(payload);
  const source = ctx.corpus.sources.get(id);
  if (!source?.blobPath) throw new Error(`source ${id} has no blob`);
  if (source.runId) return;
  const uploads = join(ctx.dir, "uploads");
  mkdirSync(uploads, { recursive: true });
  const linkPath = join(uploads, `${source.contentHash.slice(0, 8)}-${source.title.replace(/[^A-Za-z0-9._-]/g, "_")}`);
  if (!existsSync(linkPath)) symlinkSync(join(ctx.dir, source.blobPath), linkPath);
  const { run, done } = startRun(ctx, { path: linkPath });
  ctx.corpus.sources.update(id, { runId: run.id });
  await done;
};

export type ErasureResult = { segments: number; claims: number; sourcesRemoved: number; sourcesRebuilt: number; blobsRemoved: number; unassignedRemoved: number };

export function erasePerson(ctx: AppContext, person: string): ErasureResult {
  const name = person.trim();
  const result = ctx.corpus.transaction((): ErasureResult => {
    const affected = (ctx.corpus.raw.prepare("SELECT DISTINCT source_id AS id FROM segment WHERE speaker = ? COLLATE NOCASE").all(name) as { id: number }[]).map((r) => r.id);
    const claims = ctx.corpus.raw.prepare("DELETE FROM claim WHERE speaker = ? COLLATE NOCASE").run(name).changes;
    const segments = ctx.corpus.raw.prepare("DELETE FROM segment WHERE speaker = ? COLLATE NOCASE").run(name).changes;
    let sourcesRemoved = 0;
    let sourcesRebuilt = 0;
    let blobsRemoved = 0;
    for (const id of affected) {
      const source = ctx.corpus.sources.get(id)!;
      if (source.blobPath) {
        rmSync(join(ctx.dir, source.blobPath), { force: true });
        ctx.corpus.sources.update(id, { blobPath: null });
        blobsRemoved++;
      }
      const remaining = ctx.corpus.segments.list(id);
      if (remaining.length === 0) {
        ctx.corpus.sources.delete(id);
        sourcesRemoved++;
        continue;
      }
      ctx.corpus.segments.replace(id, remaining);
      ctx.jobs.enqueue("chunk", { sourceId: id, extract: false });
      sourcesRebuilt++;
    }
    return { segments, claims, sourcesRemoved, sourcesRebuilt, blobsRemoved, unassignedRemoved: 0 };
  });
  for (const row of ctx.registry.unassigned.list()) {
    const raw = ctx.registry.unassigned.raw(row.id)?.raw as { segments?: { speaker: string | null }[] } | undefined;
    if (raw?.segments?.some((s) => s.speaker?.toLowerCase() === name.toLowerCase())) {
      ctx.registry.unassigned.delete(row.id);
      result.unassignedRemoved++;
    }
  }
  return result;
}

export const RETENTION_INTERVAL_MS = 24 * 3600_000;

export function applyRetention(ctx: AppContext, days: number, now: number = Date.now()): number {
  const limit = new Date(now - days * 86_400_000).toISOString();
  const old = ctx.corpus.sources.list({ to: limit });
  for (const source of old) {
    ctx.corpus.sources.delete(source.id);
    if (source.blobPath && ctx.corpus.sources.byHash(source.contentHash) === null) rmSync(join(ctx.dir, source.blobPath), { force: true });
  }
  return old.length;
}

const retention: JobHandler = async (ctx, _payload, _job, resolve) => {
  try {
    for (const workspace of ctx.registry.workspaces.list()) {
      if (workspace.retentionDays === null) continue;
      const removed = applyRetention(resolve(workspace.slug), workspace.retentionDays);
      if (removed) ctx.log(`retention: removed ${removed} sources older than ${workspace.retentionDays} days from ${workspace.slug}`);
    }
  } finally {
    ctx.registry.jobs.enqueue(null, "retention", {}, { runAfter: new Date(Date.now() + RETENTION_INTERVAL_MS).toISOString(), dedupe: "retention" });
  }
};

const reembed: JobHandler = async (ctx) => {
  const current = ctx.textGateway.embedder();
  ctx.corpus.embeddingMeta.set({ name: current.name, model: current.model, dims: current.dims });
  ctx.corpus.chunks.clearVectors();
  enqueueEmbeds(ctx, ctx.corpus.chunks.unembeddedIds());
};

export const jobHandlers: Partial<Record<string, JobHandler>> = { normalize, chunk, embed, extract, link, "run-sensor-file": runSensorFile, reembed, retention };

const snippet = (text: string, query: string): string => {
  const words = query.toLowerCase().match(/[\p{L}\p{N}_]{3,}/gu) ?? [];
  const lower = text.toLowerCase();
  const at = words.map((w) => lower.indexOf(w)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, at - 80);
  return `${start > 0 ? "…" : ""}${text.slice(start, start + 240)}${start + 240 < text.length ? "…" : ""}`;
};

export async function search(ctx: AppContext, query: string, limit: number): Promise<SearchHit[]> {
  const fts = ctx.corpus.chunks.searchFts(query, SEARCH_CANDIDATES);
  const embedded = await ctx.textGateway.embed([query], "query");
  const vec = embedded.ok ? ctx.corpus.chunks.searchVec(embedded.value[0]!, SEARCH_CANDIDATES).map((h) => h.id) : [];
  const fused = fuseRanks([fts, vec]).slice(0, limit);
  const chunks = new Map(ctx.corpus.chunks.hits(fused.map((f) => f.id)).map((c) => [c.id, c]));
  return fused.flatMap(({ id, score, ranks }) => {
    const c = chunks.get(id);
    if (!c) return [];
    return [{ chunkId: c.id, sourceId: c.sourceId, sourceKind: c.sourceKind, sourceTitle: c.sourceTitle, kind: c.kind, snippet: snippet(c.text, query), locator: c.locator, score: Math.round(score * 1e5) / 1e5, ftsRank: ranks[0] ?? null, vecRank: ranks[1] ?? null }];
  });
}

export function openQuestions(ctx: AppContext): OpenQuestion[] {
  return ctx.corpus.columns
    .list()
    .filter((c) => c.confidence < LOW_CONFIDENCE && c.confirmedClaims === 0)
    .map((column) => {
      const claims = ctx.corpus.claims.ofColumn(column.id);
      const contact = claims.map((c) => c.speaker).find((s): s is string => s !== null) ?? null;
      const hint = column.hypothesis ? ` Our current guess is "${column.hypothesis}".` : "";
      return { column, question: `What does the column ${column.name} measure, in which unit, and how often is it logged?${hint}`, contact, hypothesisClaims: claims.length };
    })
    .sort((a, b) => a.column.confidence - b.column.confidence);
}

export function answerQuestion(ctx: AppContext, column: CatalogColumn, answer: AnswerBody): Claim {
  const now = new Date().toISOString();
  const locator = { kind: "file" as const, page: null, sheet: null, row: null, charStart: 0, charEnd: answer.text.length };
  const claimId = ctx.corpus.transaction(() => {
    const source = ctx.corpus.sources.insert({
      connectorId: null,
      kind: "note",
      externalId: `answer-${column.id}-${now}`,
      title: `Answer about ${column.name}`,
      occurredAt: now,
      contentHash: sha256(`${answer.speaker}\n${answer.text}`),
      blobPath: null,
      externalUrl: null,
      mediaType: "text/plain",
      bytes: Buffer.byteLength(answer.text),
      status: "processed",
      error: null,
      runId: null,
      parentSourceId: null,
    });
    ctx.corpus.segments.replace(source.id, [{ text: answer.text, speaker: answer.speaker, block: 0, locator }]);
    const chunkId = ctx.corpus.chunks.insert({ sourceId: source.id, kind: "passage", text: answer.text, locator, tokens: Math.ceil(answer.text.length / 4), segmentFrom: 0, segmentTo: 0 });
    const claimId = ctx.corpus.claims.insert({ chunkId, sourceId: source.id, statement: answer.text, quote: answer.text, speaker: answer.speaker, occurredAt: now, provenance: "person", status: "stated", locator, namedColumn: column.name });
    const claimChunkId = ctx.corpus.chunks.insert({ sourceId: source.id, kind: "claim", text: answer.text, locator, tokens: Math.ceil(answer.text.length / 4), segmentFrom: 0, segmentTo: 0, claimId });
    const [link] = ctx.corpus.links.replace(claimId, [{ columnId: column.id, score: 1 }]);
    ctx.corpus.links.setConfirmed(link!.id, true);
    enqueueEmbeds(ctx, [chunkId, claimChunkId]);
    return claimId;
  });
  return ctx.corpus.claims.get(claimId)!;
}

export function dataSpec(ctx: AppContext): DataSpec {
  const columns = ctx.corpus.columns.list();
  const sentences: DataSpec["sentences"] = [];
  const covered = new Set<number>();
  for (const column of columns) {
    const claims: Claim[] = ctx.corpus.claims.ofColumn(column.id).filter((c) => c.status === "confirmed" && c.links.some((l) => l.columnId === column.id && l.confirmed === true));
    if (claims.length === 0) continue;
    covered.add(column.id);
    for (const claim of claims) sentences.push({ column: column.name, text: claim.statement.replace(/\s+/g, " ").trim().replace(/[^.!?]$/, (m) => `${m}.`), claimIds: [claim.id] });
  }
  return { workspace: ctx.slug, generatedAt: new Date().toISOString(), sentences, columnsWithoutClaims: columns.filter((c) => !covered.has(c.id)).map((c) => c.name) };
}

export function corpusStats(ctx: AppContext): CorpusStats {
  const meta = ctx.corpus.embeddingMeta.get();
  const jobs = ctx.registry.jobs.counts(ctx.slug);
  return {
    sources: ctx.corpus.sources.count(),
    chunks: ctx.corpus.chunks.count(),
    claims: ctx.corpus.claims.count(),
    claimsRejected: ctx.corpus.counters.get("claims_rejected"),
    columns: ctx.corpus.columns.count(),
    embedder: meta?.model ?? null,
    dimensions: meta?.dims ?? null,
    jobsQueued: jobs.queued,
    jobsFailed: jobs.failed,
  };
}

export function confirmLink(ctx: AppContext, linkId: number, confirmed: boolean): void {
  const link = ctx.corpus.links.get(linkId);
  if (!link) throw new Error(`link ${linkId} not found`);
  ctx.corpus.links.setConfirmed(linkId, confirmed);
  if (!confirmed) return;
  const claim = ctx.corpus.claims.get(link.claimId);
  const column: CatalogColumn | null = ctx.corpus.columns.get(link.columnId);
  if (!claim || !column) return;
  const phrase = aliasPhrase(claim.statement, column);
  if (phrase) ctx.corpus.aliases.add(column.id, phrase);
}

function aliasPhrase(statement: string, column: CatalogColumn): string | null {
  const lower = statement.toLowerCase();
  if (lower.includes(column.name.toLowerCase()) || lower.includes(column.alias.toLowerCase())) return null;
  const subject = /^(?:the\s+)?([\p{L}\p{N}][\p{L}\p{N} _-]{2,40}?)\s+(?:is|are|means|measures|shows|on|oli|ovat|tarkoittaa|mittaa)\b/iu.exec(statement.trim());
  return subject?.[1]?.trim().toLowerCase() ?? null;
}
