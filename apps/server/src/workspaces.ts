import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import type { Hono } from "hono";
import type { CreateWorkspaceBody, Workspace, WorkspaceSlug } from "@tpm/schemas";
import { createApp } from "./app";
import { createContext, type AppContext } from "./context";
import { createJobRunner, type JobRunner } from "./jobs";
import type { Registry } from "./registry";

export const MAX_OPEN_WORKSPACES = 10;
export const LEGACY_SLUG = "norrin";

export type OpenWorkspace = { ctx: AppContext; app: Hono; lastUsed: number };

export type WorkspaceManager = {
  registry: Registry;
  runner: JobRunner;
  list(): Workspace[];
  open(slug: WorkspaceSlug): OpenWorkspace | null;
  create(body: CreateWorkspaceBody): Workspace;
  remove(slug: WorkspaceSlug): boolean;
  close(): void;
};

export type ManagerOptions = { dataDir: string; registry: Registry; webDist: string | null; log: (line: string) => void };

export const workspaceDir = (dataDir: string, slug: string): string => join(dataDir, "workspaces", slug);

export function migrateLegacyDb(dataDir: string, registry: Registry, log: (line: string) => void): void {
  const legacy = join(dataDir, "tpm.db");
  const target = join(workspaceDir(dataDir, LEGACY_SLUG), "tpm.db");
  if (registry.workspaces.get(LEGACY_SLUG) === null) registry.workspaces.create({ slug: LEGACY_SLUG, name: "Norrin", domains: [] });
  if (!existsSync(legacy) || existsSync(target)) return;
  const db = new Database(legacy);
  db.pragma("wal_checkpoint(TRUNCATE)");
  db.close();
  mkdirSync(workspaceDir(dataDir, LEGACY_SLUG), { recursive: true });
  renameSync(legacy, target);
  for (const suffix of ["-wal", "-shm"]) if (existsSync(`${legacy}${suffix}`)) renameSync(`${legacy}${suffix}`, `${target}${suffix}`);
  log(`moved ${legacy} to ${target}`);
}

export function createWorkspaceManager(opts: ManagerOptions): WorkspaceManager {
  const open = new Map<string, OpenWorkspace>();
  const runner = createJobRunner({
    registry: opts.registry,
    resolve: (slug) => {
      const ws = manager.open(slug ?? LEGACY_SLUG);
      if (!ws) throw new Error(`workspace ${slug} does not exist`);
      return ws.ctx;
    },
    log: opts.log,
  });

  function evict(): void {
    while (open.size > MAX_OPEN_WORKSPACES) {
      const oldest = [...open.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
      if (!oldest) return;
      oldest[1].ctx.close();
      open.delete(oldest[0]);
    }
  }

  const manager: WorkspaceManager = {
    registry: opts.registry,
    runner,
    list: () => opts.registry.workspaces.list(),
    open(slug) {
      const cached = open.get(slug);
      if (cached) {
        cached.lastUsed = Date.now();
        return cached;
      }
      if (opts.registry.workspaces.get(slug) === null) return null;
      const ctx = createContext({ slug, dbPath: join(workspaceDir(opts.dataDir, slug), "tpm.db"), dataDir: opts.dataDir, webDist: opts.webDist, log: opts.log, registry: opts.registry, runner });
      const entry: OpenWorkspace = { ctx, app: createApp(ctx), lastUsed: Date.now() };
      open.set(slug, entry);
      evict();
      return entry;
    },
    create(body) {
      if (opts.registry.workspaces.get(body.slug)) throw new Error(`workspace ${body.slug} exists`);
      mkdirSync(workspaceDir(opts.dataDir, body.slug), { recursive: true });
      return opts.registry.workspaces.create(body);
    },
    remove(slug) {
      if (opts.registry.workspaces.get(slug) === null) return false;
      open.get(slug)?.ctx.close();
      open.delete(slug);
      opts.registry.workspaces.delete(slug);
      rmSync(workspaceDir(opts.dataDir, slug), { recursive: true, force: true });
      return true;
    },
    close() {
      runner.stop();
      for (const ws of open.values()) ws.ctx.close();
      open.clear();
    },
  };
  return manager;
}
