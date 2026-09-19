import type Database from "better-sqlite3";
import {
  Locator,
  type CatalogColumn,
  type Chunk,
  type ChunkKind,
  type Claim,
  type ClaimLink,
  type ClaimStatus,
  type Provenance,
  type Segment,
  type Source,
  type SourceKind,
  type SourceStatus,
  type TextEgressRow,
  type WorkspaceSlug,
} from "@tpm/schemas";

export const VEC_DIMS = 1024;

const migrations = [
  `
  CREATE TABLE source (
    id INTEGER PRIMARY KEY,
    connector_id INTEGER NOT NULL DEFAULT 0,
    kind TEXT NOT NULL,
    external_id TEXT NOT NULL,
    title TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    blob_path TEXT,
    media_type TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'received',
    error TEXT,
    run_id TEXT,
    parent_source_id INTEGER,
    created_at TEXT NOT NULL,
    UNIQUE (connector_id, external_id)
  );
  CREATE INDEX source_hash ON source (content_hash);
  CREATE TABLE segment (
    id INTEGER PRIMARY KEY,
    source_id INTEGER NOT NULL REFERENCES source(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    text TEXT NOT NULL,
    speaker TEXT,
    locator TEXT NOT NULL,
    block INTEGER NOT NULL
  );
  CREATE INDEX segment_source ON segment (source_id, seq);
  CREATE TABLE chunk (
    id INTEGER PRIMARY KEY,
    source_id INTEGER REFERENCES source(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    text TEXT NOT NULL,
    locator TEXT NOT NULL,
    tokens INTEGER NOT NULL,
    segment_from INTEGER,
    segment_to INTEGER,
    column_id INTEGER,
    claim_id INTEGER,
    embedded INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX chunk_source ON chunk (source_id);
  CREATE INDEX chunk_column ON chunk (column_id);
  CREATE VIRTUAL TABLE chunk_vec USING vec0(embedding float[${VEC_DIMS}]);
  CREATE VIRTUAL TABLE chunk_fts USING fts5(text, content='chunk', content_rowid='id', tokenize='trigram');
  CREATE TRIGGER chunk_ai AFTER INSERT ON chunk BEGIN
    INSERT INTO chunk_fts(rowid, text) VALUES (new.id, new.text);
  END;
  CREATE TRIGGER chunk_ad AFTER DELETE ON chunk BEGIN
    INSERT INTO chunk_fts(chunk_fts, rowid, text) VALUES ('delete', old.id, old.text);
  END;
  CREATE TRIGGER chunk_au AFTER UPDATE OF text ON chunk BEGIN
    INSERT INTO chunk_fts(chunk_fts, rowid, text) VALUES ('delete', old.id, old.text);
    INSERT INTO chunk_fts(rowid, text) VALUES (new.id, new.text);
  END;
  CREATE TABLE catalog_column (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    alias TEXT NOT NULL,
    run_id TEXT NOT NULL,
    role TEXT NOT NULL,
    signal_type TEXT NOT NULL,
    hypothesis TEXT,
    confidence REAL NOT NULL,
    description TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE claim (
    id INTEGER PRIMARY KEY,
    chunk_id INTEGER REFERENCES chunk(id) ON DELETE SET NULL,
    source_id INTEGER NOT NULL REFERENCES source(id) ON DELETE CASCADE,
    statement TEXT NOT NULL,
    quote TEXT NOT NULL,
    speaker TEXT,
    occurred_at TEXT,
    provenance TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'hypothesis',
    note TEXT,
    locator TEXT NOT NULL,
    named_column TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX claim_source ON claim (source_id);
  CREATE TABLE claim_column (
    id INTEGER PRIMARY KEY,
    claim_id INTEGER NOT NULL REFERENCES claim(id) ON DELETE CASCADE,
    column_id INTEGER NOT NULL REFERENCES catalog_column(id) ON DELETE CASCADE,
    score REAL NOT NULL,
    confirmed INTEGER,
    UNIQUE (claim_id, column_id)
  );
  CREATE INDEX claim_column_column ON claim_column (column_id);
  CREATE TABLE alias (
    id INTEGER PRIMARY KEY,
    phrase TEXT NOT NULL,
    column_id INTEGER NOT NULL REFERENCES catalog_column(id) ON DELETE CASCADE,
    UNIQUE (phrase, column_id)
  );
  CREATE TABLE counter (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
  CREATE TABLE egress_log (
    id INTEGER PRIMARY KEY,
    time TEXT NOT NULL,
    purpose TEXT NOT NULL,
    destination TEXT NOT NULL,
    model TEXT NOT NULL,
    texts INTEGER NOT NULL,
    bytes INTEGER NOT NULL,
    payload_hash TEXT NOT NULL,
    status TEXT NOT NULL,
    detail TEXT NOT NULL,
    duration_ms REAL
  );
  CREATE TABLE embedding_meta (id INTEGER PRIMARY KEY CHECK (id = 1), name TEXT NOT NULL, model TEXT NOT NULL, dims INTEGER NOT NULL);
  `,
  `ALTER TABLE source ADD COLUMN external_url TEXT;`,
  `ALTER TABLE source ADD COLUMN pages INTEGER; ALTER TABLE source ADD COLUMN ocr_pages TEXT NOT NULL DEFAULT '[]';`,
  `ALTER TABLE catalog_column ADD COLUMN checks INTEGER NOT NULL DEFAULT 0; ALTER TABLE catalog_column ADD COLUMN agreeing INTEGER NOT NULL DEFAULT 0;`,
];

export type SourceDraft = Omit<Source, "id" | "workspace" | "pages" | "ocrPages" | "segments" | "chunks" | "embeddedChunks" | "claims" | "createdAt"> & { parentSourceId: number | null };
export type SegmentDraftRow = { text: string; speaker: string | null; locator: Locator; block: number };
export type ChunkDraftRow = { sourceId: number | null; kind: ChunkKind; text: string; locator: Locator; tokens: number; segmentFrom: number | null; segmentTo: number | null; columnId?: number | null; claimId?: number | null };
export type ClaimDraft = { chunkId: number; sourceId: number; statement: string; quote: string; speaker: string | null; occurredAt: string | null; provenance: Provenance; status: ClaimStatus; locator: Locator; namedColumn: string | null };
export type ColumnDraft = Omit<CatalogColumn, "id" | "claims" | "confirmedClaims">;
export type SourceFilter = { kind?: SourceKind; status?: SourceStatus; from?: string; to?: string };
export type EmbeddingMeta = { name: string; model: string; dims: number };
export type ColumnVector = { id: number; name: string; alias: string; phrases: string[]; vector: Float32Array | null };

type Row = Record<string, unknown>;

const nowIso = () => new Date().toISOString();
const bool = (v: unknown): boolean | null => (v === null || v === undefined ? null : v === 1);

export function openCorpus(db: Database.Database, workspace: WorkspaceSlug) {
  db.pragma("foreign_keys = ON");
  const version = db.pragma("user_version", { simple: true }) as number;
  migrations.slice(version).forEach((sql, i) => {
    db.transaction(() => {
      db.exec(sql);
      db.pragma(`user_version = ${version + i + 1}`);
    })();
  });
  const statements = new Map<string, Database.Statement>();
  const prepare = (sql: string): Database.Statement => {
    const cached = statements.get(sql);
    if (cached) return cached;
    const statement = db.prepare(sql);
    statements.set(sql, statement);
    return statement;
  };
  const all = (sql: string, ...params: unknown[]) => prepare(sql).all(...params) as Row[];
  const one = (sql: string, ...params: unknown[]) => prepare(sql).get(...params) as Row | undefined;
  const run = (sql: string, ...params: unknown[]) => prepare(sql).run(...params);
  const transaction = <T>(fn: () => T): T => db.transaction(fn)();

  const sourceSql = `SELECT s.*, (SELECT COUNT(*) FROM segment WHERE source_id = s.id) AS segments, (SELECT COUNT(*) FROM chunk WHERE source_id = s.id) AS chunks, (SELECT COUNT(*) FROM chunk WHERE source_id = s.id AND embedded = 1) AS embedded_chunks, (SELECT COUNT(*) FROM claim WHERE source_id = s.id) AS claims FROM source s`;
  const sourceOf = (r: Row): Source => ({
    id: r.id as number,
    workspace,
    connectorId: (r.connector_id as number) === 0 ? null : (r.connector_id as number),
    kind: r.kind as SourceKind,
    externalId: r.external_id as string,
    title: r.title as string,
    occurredAt: r.occurred_at as string,
    contentHash: r.content_hash as string,
    blobPath: r.blob_path as string | null,
    externalUrl: (r.external_url as string | null) ?? null,
    mediaType: r.media_type as string,
    bytes: r.bytes as number,
    status: r.status as SourceStatus,
    error: r.error as string | null,
    runId: r.run_id as string | null,
    pages: r.pages as number | null,
    ocrPages: JSON.parse(r.ocr_pages as string) as number[],
    segments: r.segments as number,
    chunks: r.chunks as number,
    embeddedChunks: r.embedded_chunks as number,
    claims: r.claims as number,
    createdAt: r.created_at as string,
  });
  const segmentOf = (r: Row): Segment => ({ id: r.id as number, sourceId: r.source_id as number, seq: r.seq as number, text: r.text as string, speaker: r.speaker as string | null, locator: Locator.parse(JSON.parse(r.locator as string)) });
  const chunkOf = (r: Row): Chunk => ({
    id: r.id as number,
    sourceId: r.source_id as number | null,
    kind: r.kind as ChunkKind,
    text: r.text as string,
    locator: Locator.parse(JSON.parse(r.locator as string)),
    tokens: r.tokens as number,
    segmentFrom: r.segment_from as number | null,
    segmentTo: r.segment_to as number | null,
  });
  const columnOf = (r: Row): CatalogColumn => ({
    id: r.id as number,
    name: r.name as string,
    alias: r.alias as string,
    runId: r.run_id as string,
    role: r.role as CatalogColumn["role"],
    signalType: r.signal_type as CatalogColumn["signalType"],
    hypothesis: r.hypothesis as string | null,
    confidence: r.confidence as number,
    checks: (r.checks as number | undefined) ?? 0,
    agreeing: (r.agreeing as number | undefined) ?? 0,
    description: r.description as string,
    claims: (r.claims as number | undefined) ?? 0,
    confirmedClaims: (r.confirmed_claims as number | undefined) ?? 0,
  });
  const columnSql = `SELECT c.*, (SELECT COUNT(DISTINCT cc.claim_id) FROM claim_column cc WHERE cc.column_id = c.id AND cc.confirmed IS NOT 0) AS claims, (SELECT COUNT(DISTINCT cc.claim_id) FROM claim_column cc JOIN claim cl ON cl.id = cc.claim_id WHERE cc.column_id = c.id AND cc.confirmed = 1 AND cl.status = 'confirmed') AS confirmed_claims FROM catalog_column c`;
  const linkOf = (r: Row): ClaimLink => ({ id: r.id as number, claimId: r.claim_id as number, columnId: r.column_id as number, column: r.name as string, score: r.score as number, confirmed: bool(r.confirmed) });
  const linksOf = (claimId: number): ClaimLink[] => all("SELECT cc.*, c.name FROM claim_column cc JOIN catalog_column c ON c.id = cc.column_id WHERE cc.claim_id = ? ORDER BY cc.score DESC", claimId).map(linkOf);
  const claimSql = `SELECT cl.*, s.kind AS source_kind, s.title AS source_title FROM claim cl JOIN source s ON s.id = cl.source_id`;
  const claimOf = (r: Row): Claim => ({
    id: r.id as number,
    chunkId: (r.chunk_id as number | null) ?? 0,
    sourceId: r.source_id as number,
    sourceKind: r.source_kind as SourceKind,
    sourceTitle: r.source_title as string,
    statement: r.statement as string,
    quote: r.quote as string,
    speaker: r.speaker as string | null,
    occurredAt: r.occurred_at as string | null,
    provenance: r.provenance as Provenance,
    status: r.status as ClaimStatus,
    note: r.note as string | null,
    locator: Locator.parse(JSON.parse(r.locator as string)),
    links: linksOf(r.id as number),
  });
  const egressOf = (r: Row): TextEgressRow => ({
    id: r.id as number,
    time: r.time as string,
    purpose: r.purpose as TextEgressRow["purpose"],
    destination: r.destination as string,
    model: r.model as string,
    texts: r.texts as number,
    bytes: r.bytes as number,
    payloadHash: r.payload_hash as string,
    status: r.status as TextEgressRow["status"],
    detail: r.detail as string,
    durationMs: r.duration_ms as number | null,
  });

  return {
    raw: db,
    transaction,
    sources: {
      insert(draft: SourceDraft): Source {
        const info = run(
          "INSERT INTO source (connector_id, kind, external_id, title, occurred_at, content_hash, blob_path, external_url, media_type, bytes, status, error, run_id, parent_source_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          draft.connectorId ?? 0, draft.kind, draft.externalId, draft.title, draft.occurredAt, draft.contentHash, draft.blobPath, draft.externalUrl, draft.mediaType, draft.bytes, draft.status, draft.error, draft.runId, draft.parentSourceId, nowIso(),
        );
        return sourceOf(one(`${sourceSql} WHERE s.id = ?`, info.lastInsertRowid)!);
      },
      get: (id: number): Source | null => {
        const r = one(`${sourceSql} WHERE s.id = ?`, id);
        return r ? sourceOf(r) : null;
      },
      byExternalId: (connectorId: number | null, externalId: string): Source | null => {
        const r = one(`${sourceSql} WHERE s.connector_id = ? AND s.external_id = ?`, connectorId ?? 0, externalId);
        return r ? sourceOf(r) : null;
      },
      byHash: (contentHash: string): Source | null => {
        const r = one(`${sourceSql} WHERE s.content_hash = ? ORDER BY s.id LIMIT 1`, contentHash);
        return r ? sourceOf(r) : null;
      },
      list(filter: SourceFilter = {}): Source[] {
        const where: string[] = [];
        const params: unknown[] = [];
        const clauses: [string, string | undefined][] = [["s.kind = ?", filter.kind], ["s.status = ?", filter.status], ["s.occurred_at >= ?", filter.from], ["s.occurred_at <= ?", filter.to]];
        for (const [clause, value] of clauses) {
          if (value === undefined) continue;
          where.push(clause);
          params.push(value);
        }
        return all(`${sourceSql} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY s.occurred_at DESC, s.id DESC`, ...params).map(sourceOf);
      },
      setStatus: (id: number, status: SourceStatus, error: string | null = null): void => void run("UPDATE source SET status = ?, error = ? WHERE id = ?", status, error, id),
      setPages: (id: number, pages: number | null, ocrPages: number[]): void => void run("UPDATE source SET pages = ?, ocr_pages = ? WHERE id = ?", pages, JSON.stringify(ocrPages), id),
      update: (id: number, patch: Partial<Pick<Source, "title" | "occurredAt" | "runId" | "contentHash" | "blobPath" | "bytes" | "externalUrl">>): void => {
        const fields: Record<string, string> = { title: "title", occurredAt: "occurred_at", runId: "run_id", contentHash: "content_hash", blobPath: "blob_path", bytes: "bytes", externalUrl: "external_url" };
        const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
        if (entries.length === 0) return;
        run(`UPDATE source SET ${entries.map(([k]) => `${fields[k]} = ?`).join(", ")} WHERE id = ?`, ...entries.map(([, v]) => v), id);
      },
      delete(id: number): void {
        transaction(() => {
          for (const r of all("SELECT id FROM chunk WHERE source_id = ?", id)) run("DELETE FROM chunk_vec WHERE rowid = ?", BigInt(r.id as number));
          run("DELETE FROM source WHERE id = ?", id);
        });
      },
      count: (): number => (one("SELECT COUNT(*) AS n FROM source")?.n as number) ?? 0,
    },
    segments: {
      replace(sourceId: number, drafts: SegmentDraftRow[]): void {
        transaction(() => {
          run("DELETE FROM segment WHERE source_id = ?", sourceId);
          drafts.forEach((d, seq) => run("INSERT INTO segment (source_id, seq, text, speaker, locator, block) VALUES (?, ?, ?, ?, ?, ?)", sourceId, seq, d.text, d.speaker, JSON.stringify(d.locator), d.block));
        });
      },
      list: (sourceId: number): (Segment & { block: number })[] => all("SELECT * FROM segment WHERE source_id = ? ORDER BY seq", sourceId).map((r) => ({ ...segmentOf(r), block: r.block as number })),
    },
    chunks: {
      insert(draft: ChunkDraftRow): number {
        return Number(
          run(
            "INSERT INTO chunk (source_id, kind, text, locator, tokens, segment_from, segment_to, column_id, claim_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            draft.sourceId, draft.kind, draft.text, JSON.stringify(draft.locator), draft.tokens, draft.segmentFrom, draft.segmentTo, draft.columnId ?? null, draft.claimId ?? null,
          ).lastInsertRowid,
        );
      },
      deleteOfSource(sourceId: number): void {
        transaction(() => {
          for (const r of all("SELECT id FROM chunk WHERE source_id = ?", sourceId)) run("DELETE FROM chunk_vec WHERE rowid = ?", BigInt(r.id as number));
          run("DELETE FROM chunk WHERE source_id = ?", sourceId);
        });
      },
      deleteOfColumn(columnId: number): void {
        transaction(() => {
          for (const r of all("SELECT id FROM chunk WHERE column_id = ?", columnId)) run("DELETE FROM chunk_vec WHERE rowid = ?", BigInt(r.id as number));
          run("DELETE FROM chunk WHERE column_id = ?", columnId);
        });
      },
      get: (id: number): Chunk | null => {
        const r = one("SELECT * FROM chunk WHERE id = ?", id);
        return r ? chunkOf(r) : null;
      },
      idsOfSource: (sourceId: number): number[] => all("SELECT id FROM chunk WHERE source_id = ? ORDER BY id", sourceId).map((r) => r.id as number),
      texts: (ids: number[]): { id: number; text: string }[] => ids.flatMap((id) => {
        const r = one("SELECT id, text FROM chunk WHERE id = ?", id);
        return r ? [{ id: r.id as number, text: r.text as string }] : [];
      }),
      setVector(id: number, vector: Float32Array): void {
        transaction(() => {
          run("DELETE FROM chunk_vec WHERE rowid = ?", BigInt(id));
          run("INSERT INTO chunk_vec (rowid, embedding) VALUES (?, ?)", BigInt(id), vector);
          run("UPDATE chunk SET embedded = 1 WHERE id = ?", id);
        });
      },
      vector(id: number): Float32Array | null {
        const r = one("SELECT embedding FROM chunk_vec WHERE rowid = ?", BigInt(id));
        if (!r) return null;
        const buf = r.embedding as Buffer;
        return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
      },
      unembeddedIds: (): number[] => all("SELECT id FROM chunk WHERE embedded = 0 ORDER BY id").map((r) => r.id as number),
      clearVectors(): void {
        transaction(() => {
          run("DELETE FROM chunk_vec");
          run("UPDATE chunk SET embedded = 0");
        });
      },
      count: (): number => (one("SELECT COUNT(*) AS n FROM chunk")?.n as number) ?? 0,
      searchFts(query: string, limit: number): number[] {
        const terms = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}_]{3,}/gu) ?? [])];
        if (terms.length === 0) return [];
        const match = terms.map((t) => `"${t.replace(/"/g, '""')}"`).join(" OR ");
        return all("SELECT rowid FROM chunk_fts WHERE chunk_fts MATCH ? ORDER BY bm25(chunk_fts) LIMIT ?", match, limit).map((r) => r.rowid as number);
      },
      searchVec: (vector: Float32Array, limit: number): { id: number; distance: number }[] =>
        all("SELECT rowid, distance FROM chunk_vec WHERE embedding MATCH ? ORDER BY distance LIMIT ?", vector, limit).map((r) => ({ id: r.rowid as number, distance: r.distance as number })),
      hits: (ids: number[]): (Chunk & { sourceKind: SourceKind | null; sourceTitle: string })[] =>
        ids.flatMap((id) => {
          const r = one("SELECT ch.*, s.kind AS source_kind, COALESCE(s.title, cc.name, '') AS source_title FROM chunk ch LEFT JOIN source s ON s.id = ch.source_id LEFT JOIN catalog_column cc ON cc.id = ch.column_id WHERE ch.id = ?", id);
          return r ? [{ ...chunkOf(r), sourceKind: r.source_kind as SourceKind | null, sourceTitle: r.source_title as string }] : [];
        }),
    },
    claims: {
      insert(draft: ClaimDraft): number {
        return Number(
          run(
            "INSERT INTO claim (chunk_id, source_id, statement, quote, speaker, occurred_at, provenance, status, locator, named_column, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            draft.chunkId, draft.sourceId, draft.statement, draft.quote, draft.speaker, draft.occurredAt, draft.provenance, draft.status, JSON.stringify(draft.locator), draft.namedColumn, nowIso(),
          ).lastInsertRowid,
        );
      },
      get: (id: number): Claim | null => {
        const r = one(`${claimSql} WHERE cl.id = ?`, id);
        return r ? claimOf(r) : null;
      },
      namedColumn: (id: number): string | null => (one("SELECT named_column FROM claim WHERE id = ?", id)?.named_column as string | null) ?? null,
      list: (): Claim[] => all(`${claimSql} ORDER BY cl.id DESC`).map(claimOf),
      ofSource: (sourceId: number): Claim[] => all(`${claimSql} WHERE cl.source_id = ? ORDER BY cl.id`, sourceId).map(claimOf),
      ofColumn: (columnId: number): Claim[] =>
        all(`${claimSql} WHERE cl.id IN (SELECT claim_id FROM claim_column WHERE column_id = ? AND confirmed IS NOT 0) ORDER BY cl.status = 'confirmed' DESC, cl.id DESC`, columnId).map(claimOf),
      ofChunk: (chunkId: number): Claim[] => all(`${claimSql} WHERE cl.chunk_id = ? ORDER BY cl.id`, chunkId).map(claimOf),
      confirmed: (): Claim[] => all(`${claimSql} WHERE cl.status = 'confirmed' ORDER BY cl.id`).map(claimOf),
      setStatus: (id: number, status: ClaimStatus, note: string | null = null): void => void run("UPDATE claim SET status = ?, note = COALESCE(?, note) WHERE id = ?", status, note, id),
      detach: (chunkId: number, note: string): void => void run("UPDATE claim SET chunk_id = NULL, note = ? WHERE chunk_id = ?", note, chunkId),
      deleteOfSource: (sourceId: number): void => void run("DELETE FROM claim WHERE source_id = ?", sourceId),
      count: (): number => (one("SELECT COUNT(*) AS n FROM claim")?.n as number) ?? 0,
    },
    links: {
      replace(claimId: number, candidates: { columnId: number; score: number }[]): ClaimLink[] {
        transaction(() => {
          run("DELETE FROM claim_column WHERE claim_id = ? AND confirmed IS NULL", claimId);
          for (const c of candidates) run("INSERT OR IGNORE INTO claim_column (claim_id, column_id, score, confirmed) VALUES (?, ?, ?, NULL)", claimId, c.columnId, c.score);
        });
        return linksOf(claimId);
      },
      get: (id: number): ClaimLink | null => {
        const r = one("SELECT cc.*, c.name FROM claim_column cc JOIN catalog_column c ON c.id = cc.column_id WHERE cc.id = ?", id);
        return r ? linkOf(r) : null;
      },
      setConfirmed: (id: number, confirmed: boolean): void => void run("UPDATE claim_column SET confirmed = ? WHERE id = ?", confirmed ? 1 : 0, id),
    },
    columns: {
      upsert(draft: ColumnDraft): CatalogColumn {
        run(
          `INSERT INTO catalog_column (name, alias, run_id, role, signal_type, hypothesis, confidence, checks, agreeing, description, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(name) DO UPDATE SET alias = excluded.alias, run_id = excluded.run_id, role = excluded.role, signal_type = excluded.signal_type, hypothesis = excluded.hypothesis, confidence = excluded.confidence, checks = excluded.checks, agreeing = excluded.agreeing, description = excluded.description, updated_at = excluded.updated_at`,
          draft.name, draft.alias, draft.runId, draft.role, draft.signalType, draft.hypothesis, draft.confidence, draft.checks, draft.agreeing, draft.description, nowIso(),
        );
        return columnOf(one(`${columnSql} WHERE c.name = ?`, draft.name)!);
      },
      get: (id: number): CatalogColumn | null => {
        const r = one(`${columnSql} WHERE c.id = ?`, id);
        return r ? columnOf(r) : null;
      },
      byName: (name: string): CatalogColumn | null => {
        const r = one(`${columnSql} WHERE c.name = ?`, name);
        return r ? columnOf(r) : null;
      },
      byAlias: (runId: string, alias: string): CatalogColumn | null => {
        const r = one(`${columnSql} WHERE c.run_id = ? AND c.alias = ?`, runId, alias);
        return r ? columnOf(r) : null;
      },
      list: (): CatalogColumn[] => all(`${columnSql} ORDER BY c.alias`).map(columnOf),
      descriptionChunkId: (columnId: number): number | null => (one("SELECT id FROM chunk WHERE kind = 'column' AND column_id = ?", columnId)?.id as number | undefined) ?? null,
      vectors(): ColumnVector[] {
        return all("SELECT c.id, c.name, c.alias, ch.id AS chunk_id FROM catalog_column c LEFT JOIN chunk ch ON ch.column_id = c.id AND ch.kind = 'column' AND ch.embedded = 1 ORDER BY c.id").map((r) => {
          const chunkId = r.chunk_id as number | null;
          const buf = chunkId === null ? null : (one("SELECT embedding FROM chunk_vec WHERE rowid = ?", BigInt(chunkId))?.embedding as Buffer | undefined) ?? null;
          return {
            id: r.id as number,
            name: r.name as string,
            alias: r.alias as string,
            phrases: all("SELECT phrase FROM alias WHERE column_id = ?", r.id).map((a) => a.phrase as string),
            vector: buf ? new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)) : null,
          };
        });
      },
      count: (): number => (one("SELECT COUNT(*) AS n FROM catalog_column")?.n as number) ?? 0,
    },
    aliases: {
      add: (columnId: number, phrase: string): void => void run("INSERT OR IGNORE INTO alias (phrase, column_id) VALUES (?, ?)", phrase.trim(), columnId),
      ofColumn: (columnId: number): string[] => all("SELECT phrase FROM alias WHERE column_id = ? ORDER BY phrase", columnId).map((r) => r.phrase as string),
    },
    counters: {
      add: (key: string, by: number = 1): void => void run("INSERT INTO counter (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = value + excluded.value", key, by),
      get: (key: string): number => (one("SELECT value FROM counter WHERE key = ?", key)?.value as number | undefined) ?? 0,
    },
    egressLog: {
      write: (row: Omit<TextEgressRow, "id">): void =>
        void run("INSERT INTO egress_log (time, purpose, destination, model, texts, bytes, payload_hash, status, detail, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", row.time, row.purpose, row.destination, row.model, row.texts, row.bytes, row.payloadHash, row.status, row.detail, row.durationMs),
      list: (limit: number = 200): TextEgressRow[] => all("SELECT * FROM egress_log ORDER BY id DESC LIMIT ?", limit).map(egressOf),
    },
    embeddingMeta: {
      get: (): EmbeddingMeta | null => {
        const r = one("SELECT name, model, dims FROM embedding_meta WHERE id = 1");
        return r ? { name: r.name as string, model: r.model as string, dims: r.dims as number } : null;
      },
      set: (meta: EmbeddingMeta): void => void run("INSERT INTO embedding_meta (id, name, model, dims) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, model = excluded.model, dims = excluded.dims", meta.name, meta.model, meta.dims),
    },
  };
}

export type CorpusDb = ReturnType<typeof openCorpus>;
