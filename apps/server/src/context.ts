import { openDb, type Db } from "./db";
import { wireGateway } from "./egress-wiring";
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

export function createContext(opts: ContextOptions = {}): AppContext {
  const db = openDb(opts.dbPath);
  return {
    db,
    hub: createHub(db.runs.get),
    gateway: wireGateway(db),
    dataDir: opts.dataDir ?? paths.dataDir,
    webDist: opts.webDist === undefined ? paths.webDist : opts.webDist,
    log: opts.log ?? console.log,
  };
}
