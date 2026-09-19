import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { createTextGateway, type Gateway, type GatewayOptions, type TextGateway } from "@tpm/egress";
import type { JobType, WorkspaceSlug } from "@tpm/schemas";
import { refreshCatalog } from "./catalog";
import { openCorpus, type CorpusDb } from "./corpus-db";
import { openDb, type Db } from "./db";
import { wireGateway } from "./egress-wiring";
import { createJobRunner, type EnqueueOptions, type JobRunner } from "./jobs";
import { appendLog } from "./log";
import * as paths from "./paths";
import { openRegistry, type Registry } from "./registry";
import { loadSecretKey, secretBox } from "./secrets";
import { getModelMode } from "./settings";
import { createHub, type RunHub } from "./sse";

export type JobQueue = { enqueue(type: JobType, payload: Record<string, unknown>, opts?: EnqueueOptions): number | null; runPending(): Promise<number> };

export type AppContext = {
  slug: WorkspaceSlug;
  dir: string;
  blobDir: string;
  db: Db;
  corpus: CorpusDb;
  hub: RunHub;
  gateway: Gateway;
  textGateway: TextGateway;
  registry: Registry;
  jobs: JobQueue;
  dataDir: string;
  webDist: string | null;
  log: (line: string) => void;
  close(): void;
};

export type ContextOptions = Partial<
  Pick<AppContext, "dataDir" | "webDist" | "log" | "slug" | "registry"> & { dbPath: string; runner: JobRunner } & Pick<
      GatewayOptions,
      "resolveProvider" | "resolveReviewers"
    >
>;

function failInterruptedRuns(db: Db): void {
  const error = "server restarted";
  for (const run of db.runs.list().filter((r) => r.status === "queued" || r.status === "running")) {
    db.transaction(() => {
      appendLog(db, { type: "run-finished", actor: "agent", runId: run.id, inferenceId: null, evidenceIds: [], egressId: null, before: null, after: { status: "failed" }, reason: error });
      db.runs.save({ ...run, status: "failed", error, finishedAt: new Date().toISOString(), stages: run.stages.map((s) => (s.status === "running" ? { ...s, status: "failed" } : s)) });
    });
  }
}

export function openRegistryAt(dataDir: string, log: (line: string) => void): Registry {
  return openRegistry(join(dataDir, "registry.db"), secretBox(loadSecretKey(join(dataDir, "secret.key"), log)));
}

export function createContext(opts: ContextOptions = {}): AppContext {
  const dataDir = opts.dataDir ?? paths.dataDir;
  const log = opts.log ?? console.log;
  const slug = opts.slug ?? "norrin";
  const dbPath = opts.dbPath ?? paths.dbPath;
  const dir = dbPath === ":memory:" ? join(dataDir, "workspaces", slug) : dirname(dbPath);
  const blobDir = join(dir, "blobs");
  mkdirSync(blobDir, { recursive: true });
  const db = openDb(dbPath);
  failInterruptedRuns(db);
  const corpus = openCorpus(db.raw, slug);
  const registry = opts.registry ?? openRegistryAt(dataDir, log);
  const gateway = wireGateway(db, {
    ...(opts.resolveProvider ? { resolveProvider: opts.resolveProvider } : {}),
    ...(opts.resolveReviewers ? { resolveReviewers: opts.resolveReviewers } : {}),
  });
  const textGateway = createTextGateway({ store: corpus.egressLog, getMode: () => getModelMode(db, gateway) });
  const ctx: AppContext = {
    slug,
    dir,
    blobDir,
    db,
    corpus,
    hub: createHub(db.runs.get),
    gateway,
    textGateway,
    registry,
    jobs: null as unknown as JobQueue,
    dataDir,
    webDist: opts.webDist === undefined ? paths.webDist : opts.webDist,
    log,
    close() {
      db.close();
      if (!opts.registry) registry.close();
    },
  };
  const runner = opts.runner ?? createJobRunner({ registry, resolve: () => ctx, log });
  ctx.jobs = { enqueue: (type, payload, o) => runner.enqueue(slug, type, payload, o), runPending: runner.runPending };
  if (corpus.columns.count() === 0) {
    const newest = db.runs.list().find((r) => r.status === "done");
    if (newest) refreshCatalog(ctx, newest.id);
  }
  return ctx;
}
