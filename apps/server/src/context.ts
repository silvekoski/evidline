import { openDb, type Db } from "./db";
import { wireGateway } from "./egress-wiring";
import { appendLog } from "./log";
import * as paths from "./paths";
import { createHub, type RunHub } from "./sse";
import type { Gateway } from "@tpm/egress";

export type AppContext = {
  db: Db;
  hub: RunHub;
  gateway: Gateway;
  dataDir: string;
  webDist: string | null;
  log: (line: string) => void;
};

export type ContextOptions = Partial<Pick<AppContext, "dataDir" | "webDist" | "log"> & { dbPath: string }>;

function failInterruptedRuns(db: Db): void {
  const error = "server restarted";
  for (const run of db.runs.list().filter((r) => r.status === "queued" || r.status === "running")) {
    db.transaction(() => {
      appendLog(db, { type: "run-finished", actor: "agent", runId: run.id, inferenceId: null, evidenceIds: [], egressId: null, before: null, after: { status: "failed" }, reason: error });
      db.runs.save({ ...run, status: "failed", error, finishedAt: new Date().toISOString(), stages: run.stages.map((s) => (s.status === "running" ? { ...s, status: "failed" } : s)) });
    });
  }
}

export function createContext(opts: ContextOptions = {}): AppContext {
  const db = openDb(opts.dbPath);
  failInterruptedRuns(db);
  return {
    db,
    hub: createHub(db.runs.get),
    gateway: wireGateway(db),
    dataDir: opts.dataDir ?? paths.dataDir,
    webDist: opts.webDist === undefined ? paths.webDist : opts.webDist,
    log: opts.log ?? console.log,
  };
}
