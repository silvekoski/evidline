import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type { Connector, ConnectorKind, CreateConnectorBody, CreateWorkspaceBody, Job, JobType, UnassignedSource, Workspace, WorkspaceSlug } from "@tpm/schemas";
import type { SecretBox } from "./secrets";

const schema = `
CREATE TABLE IF NOT EXISTS workspace (slug TEXT PRIMARY KEY, name TEXT NOT NULL, domains TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS connector (
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, workspace TEXT, config TEXT NOT NULL, secret TEXT,
  status TEXT NOT NULL DEFAULT 'idle', cursor TEXT, last_sync_at TEXT, last_error TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS job (
  id INTEGER PRIMARY KEY, workspace TEXT, type TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0, run_after TEXT NOT NULL, last_error TEXT, created_at TEXT NOT NULL, finished_at TEXT, dedupe TEXT
);
CREATE INDEX IF NOT EXISTS job_queue ON job (status, run_after);
CREATE UNIQUE INDEX IF NOT EXISTS job_dedupe ON job (dedupe) WHERE dedupe IS NOT NULL AND status IN ('queued', 'running');
CREATE TABLE IF NOT EXISTS upload_link (token TEXT PRIMARY KEY, workspace TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS setting (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS unassigned (
  id INTEGER PRIMARY KEY, connector_id INTEGER NOT NULL, kind TEXT NOT NULL, external_id TEXT NOT NULL, title TEXT NOT NULL, occurred_at TEXT NOT NULL,
  candidates TEXT NOT NULL, raw TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE (connector_id, external_id)
);
`;

type Row = Record<string, unknown>;
const nowIso = () => new Date().toISOString();
export const MAX_ATTEMPTS = 5;
export const retryDelayMs = (attempt: number): number => 5000 * 2 ** attempt;

export function openRegistry(path: string, secrets: SecretBox) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(schema);
  const all = (sql: string, ...params: unknown[]) => db.prepare(sql).all(...params) as Row[];
  const one = (sql: string, ...params: unknown[]) => db.prepare(sql).get(...params) as Row | undefined;
  const run = (sql: string, ...params: unknown[]) => db.prepare(sql).run(...params);

  const workspaceOf = (r: Row): Workspace => ({ slug: r.slug as string, name: r.name as string, domains: JSON.parse(r.domains as string) as string[], createdAt: r.created_at as string });
  const connectorOf = (r: Row): Connector => ({
    id: r.id as number,
    kind: r.kind as ConnectorKind,
    name: r.name as string,
    workspace: r.workspace as string | null,
    config: JSON.parse(r.config as string) as Record<string, unknown>,
    status: r.status as Connector["status"],
    cursor: r.cursor as string | null,
    lastSyncAt: r.last_sync_at as string | null,
    lastError: r.last_error as string | null,
    createdAt: r.created_at as string,
  });
  const jobOf = (r: Row): Job => ({
    id: r.id as number,
    workspace: r.workspace as string | null,
    type: r.type as JobType,
    payload: JSON.parse(r.payload as string) as Record<string, unknown>,
    status: r.status as Job["status"],
    attempts: r.attempts as number,
    runAfter: r.run_after as string,
    lastError: r.last_error as string | null,
    createdAt: r.created_at as string,
    finishedAt: r.finished_at as string | null,
  });

  return {
    raw: db,
    close: (): void => void db.close(),
    workspaces: {
      list: (): Workspace[] => all("SELECT * FROM workspace ORDER BY created_at, slug").map(workspaceOf),
      get: (slug: string): Workspace | null => {
        const r = one("SELECT * FROM workspace WHERE slug = ?", slug);
        return r ? workspaceOf(r) : null;
      },
      create(body: CreateWorkspaceBody): Workspace {
        run("INSERT INTO workspace (slug, name, domains, created_at) VALUES (?, ?, ?, ?)", body.slug, body.name, JSON.stringify(body.domains), nowIso());
        return workspaceOf(one("SELECT * FROM workspace WHERE slug = ?", body.slug)!);
      },
      delete(slug: string): void {
        db.transaction(() => {
          run("DELETE FROM job WHERE workspace = ?", slug);
          run("DELETE FROM upload_link WHERE workspace = ?", slug);
          run("UPDATE connector SET workspace = NULL WHERE workspace = ?", slug);
          run("DELETE FROM workspace WHERE slug = ?", slug);
        })();
      },
      byDomain: (domain: string): Workspace[] => all("SELECT * FROM workspace").map(workspaceOf).filter((w) => w.domains.some((d) => d.toLowerCase() === domain.toLowerCase())),
    },
    connectors: {
      list: (workspace?: WorkspaceSlug): Connector[] =>
        (workspace === undefined ? all("SELECT * FROM connector ORDER BY id") : all("SELECT * FROM connector WHERE workspace = ? OR workspace IS NULL ORDER BY id", workspace)).map(connectorOf),
      get: (id: number): Connector | null => {
        const r = one("SELECT * FROM connector WHERE id = ?", id);
        return r ? connectorOf(r) : null;
      },
      create(body: CreateConnectorBody): Connector {
        const info = run(
          "INSERT INTO connector (kind, name, workspace, config, secret, created_at) VALUES (?, ?, ?, ?, ?, ?)",
          body.kind, body.name, body.workspace, JSON.stringify(body.config), body.secret === null ? null : secrets.seal(body.secret), nowIso(),
        );
        return connectorOf(one("SELECT * FROM connector WHERE id = ?", info.lastInsertRowid)!);
      },
      secret(id: number): string | null {
        const sealed = one("SELECT secret FROM connector WHERE id = ?", id)?.secret as string | null | undefined;
        return sealed ? secrets.open(sealed) : null;
      },
      update: (id: number, patch: Partial<Pick<Connector, "status" | "cursor" | "lastSyncAt" | "lastError" | "config">>): void => {
        const fields: Record<string, string> = { status: "status", cursor: "cursor", lastSyncAt: "last_sync_at", lastError: "last_error", config: "config" };
        const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
        if (entries.length === 0) return;
        run(`UPDATE connector SET ${entries.map(([k]) => `${fields[k]} = ?`).join(", ")} WHERE id = ?`, ...entries.map(([k, v]) => (k === "config" ? JSON.stringify(v) : v)), id);
      },
      delete: (id: number): void => void run("DELETE FROM connector WHERE id = ?", id),
    },
    jobs: {
      enqueue(workspace: WorkspaceSlug | null, type: JobType, payload: Record<string, unknown>, opts: { runAfter?: string; dedupe?: string } = {}): number | null {
        const info = run(
          "INSERT OR IGNORE INTO job (workspace, type, payload, run_after, created_at, dedupe) VALUES (?, ?, ?, ?, ?, ?)",
          workspace, type, JSON.stringify(payload), opts.runAfter ?? nowIso(), nowIso(), opts.dedupe ?? null,
        );
        return info.changes === 0 ? null : Number(info.lastInsertRowid);
      },
      claim(): Job | null {
        return db.transaction(() => {
          const r = one("SELECT * FROM job WHERE status = 'queued' AND run_after <= ? ORDER BY id LIMIT 1", nowIso());
          if (!r) return null;
          run("UPDATE job SET status = 'running', attempts = attempts + 1 WHERE id = ?", r.id);
          return jobOf({ ...r, status: "running", attempts: (r.attempts as number) + 1 });
        })();
      },
      done: (id: number): void => void run("UPDATE job SET status = 'done', finished_at = ?, last_error = NULL WHERE id = ?", nowIso(), id),
      fail(job: Job, error: string): void {
        if (job.attempts >= MAX_ATTEMPTS) run("UPDATE job SET status = 'failed', finished_at = ?, last_error = ? WHERE id = ?", nowIso(), error, job.id);
        else run("UPDATE job SET status = 'queued', run_after = ?, last_error = ? WHERE id = ?", new Date(Date.now() + retryDelayMs(job.attempts)).toISOString(), error, job.id);
      },
      list: (workspace?: WorkspaceSlug, limit: number = 200): Job[] =>
        (workspace === undefined ? all("SELECT * FROM job ORDER BY id DESC LIMIT ?", limit) : all("SELECT * FROM job WHERE workspace = ? ORDER BY id DESC LIMIT ?", workspace, limit)).map(jobOf),
      counts(workspace: WorkspaceSlug): { queued: number; failed: number } {
        const r = one("SELECT SUM(status IN ('queued', 'running')) AS queued, SUM(status = 'failed') AS failed FROM job WHERE workspace = ?", workspace);
        return { queued: (r?.queued as number | null) ?? 0, failed: (r?.failed as number | null) ?? 0 };
      },
      resetRunning: (): void => void run("UPDATE job SET status = 'queued' WHERE status = 'running'"),
      retryFailed: (workspace: WorkspaceSlug): number => run("UPDATE job SET status = 'queued', attempts = 0, run_after = ? WHERE workspace = ? AND status = 'failed'", nowIso(), workspace).changes,
    },
    uploadLinks: {
      create(workspace: WorkspaceSlug, hours: number): { token: string; expiresAt: string } {
        const token = randomBytes(18).toString("base64url");
        const expiresAt = new Date(Date.now() + hours * 3600_000).toISOString();
        run("INSERT INTO upload_link (token, workspace, expires_at, created_at) VALUES (?, ?, ?, ?)", token, workspace, expiresAt, nowIso());
        return { token, expiresAt };
      },
      resolve(token: string): WorkspaceSlug | null {
        const r = one("SELECT workspace, expires_at FROM upload_link WHERE token = ?", token);
        if (!r || (r.expires_at as string) < nowIso()) return null;
        return r.workspace as string;
      },
    },
    unassigned: {
      put(row: Omit<UnassignedSource, "id" | "createdAt" | "connectorName">, raw: unknown): void {
        run(
          `INSERT INTO unassigned (connector_id, kind, external_id, title, occurred_at, candidates, raw, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(connector_id, external_id) DO UPDATE SET title = excluded.title, occurred_at = excluded.occurred_at, candidates = excluded.candidates, raw = excluded.raw`,
          row.connectorId, row.kind, row.externalId, row.title, row.occurredAt, JSON.stringify(row.candidates), JSON.stringify(raw), nowIso(),
        );
      },
      list: (): UnassignedSource[] =>
        all("SELECT u.*, c.name AS connector_name FROM unassigned u JOIN connector c ON c.id = u.connector_id ORDER BY u.occurred_at DESC").map((r) => ({
          id: r.id as number,
          connectorId: r.connector_id as number,
          connectorName: r.connector_name as string,
          kind: r.kind as UnassignedSource["kind"],
          externalId: r.external_id as string,
          title: r.title as string,
          occurredAt: r.occurred_at as string,
          candidates: JSON.parse(r.candidates as string) as string[],
          createdAt: r.created_at as string,
        })),
      raw: (id: number): { connectorId: number; raw: unknown } | null => {
        const r = one("SELECT connector_id, raw FROM unassigned WHERE id = ?", id);
        return r ? { connectorId: r.connector_id as number, raw: JSON.parse(r.raw as string) as unknown } : null;
      },
      delete: (id: number): void => void run("DELETE FROM unassigned WHERE id = ?", id),
      count: (): number => (one("SELECT COUNT(*) AS n FROM unassigned")?.n as number) ?? 0,
    },
    settings: {
      get: (key: string): string | null => (one("SELECT value FROM setting WHERE key = ?", key)?.value as string | undefined) ?? null,
      set: (key: string, value: string): void => void run("INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, value),
    },
  };
}

export type Registry = ReturnType<typeof openRegistry>;
