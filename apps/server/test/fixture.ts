import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EgressRecord, Run } from "@tpm/schemas";
import { createApp } from "../src/app";
import { createContext, type AppContext, type ContextOptions } from "../src/context";

export type Fixture = { ctx: AppContext; app: ReturnType<typeof createApp>; dir: string; close(): void };

export function fixture(opts: Pick<ContextOptions, "resolveProvider" | "resolveReviewers"> = {}): Fixture {
  const dir = mkdtempSync(join(tmpdir(), "tpm-server-"));
  const ctx = createContext({ dbPath: join(dir, "tpm.db"), dataDir: join(dir, "data"), webDist: null, log: () => {}, ...opts });
  return {
    ctx,
    app: createApp(ctx),
    dir,
    close() {
      ctx.db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function run(id: string, overrides: Partial<Run> = {}): Run {
  return {
    id,
    name: "demo-stream.csv",
    domain: "stream",
    status: "done",
    createdAt: "2026-09-19T10:00:00.000Z",
    finishedAt: "2026-09-19T10:01:00.000Z",
    rows: 20000,
    columns: 54,
    sensorCount: 52,
    quarantined: ["sample"],
    episodes: 21,
    rawBytes: 1000,
    gridSize: 20000,
    bucket: 1,
    timeBase: { t0: 1767225600000, dt: 180000, n: 20000 },
    commitHash: "abc",
    templateHashes: { name_role: "a", compile_rule: "b", explain_diagnosis: "c", plan_investigation: "d" },
    stages: [],
    error: null,
    parentRunId: null,
    ...overrides,
  };
}

export function egressRecord(id: string, runId: string, status: EgressRecord["status"], overrides: Partial<EgressRecord> = {}): EgressRecord {
  const blocked = status === "blocked";
  return {
    id,
    runId,
    time: "2026-09-19T10:00:00.000Z",
    purpose: "name_role",
    mode: status === "off" ? "off" : "cloud",
    provider: status === "sent" ? { name: "azure", model: "gpt", region: "swedencentral", host: "https://plant.openai.azure.com" } : null,
    payload: '{"purpose":"name_role"}',
    payloadBytes: 23,
    guards: [
      { name: "schema", pass: true, detail: "ok" },
      { name: "leak", pass: !blocked, detail: blocked ? "1 run of 3 raw samples" : "none", hits: blocked ? 1 : 0 },
    ],
    templateHash: "t",
    inferenceId: null,
    operatorText: false,
    status,
    response: null,
    validator: null,
    durationMs: null,
    ...overrides,
  };
}
