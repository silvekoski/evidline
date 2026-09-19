import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type { Grid } from "@tpm/core";
import type { EgressRecord, Evidence, Fingerprint, Inference, RedundancyGroup, Relation, Rule, Run, Stage, ThreadEntry } from "@tpm/schemas";
import { dbPath } from "./paths";

export type SensorPeer = { alias: string; lag: number; rho: number; n: number };
export type SensorRecord = {
  runId: string;
  alias: string;
  index: number;
  sourceName: string;
  fingerprint: Fingerprint;
  relations: Relation[];
  redundancyGroup: RedundancyGroup | null;
  peers: SensorPeer[];
  flowIndex: number | null;
};
export type LogRow = { seq: number; runId: string; text: string; hash: string };
export type GridSeries = { alias: string; values: Float64Array };

type GridRow = GridSeries & { runId: string };
type SeriesRow = { evidenceId: string; key: string; values: Float64Array };
type SettingRow = { key: string; value: string };

type ColumnType = "text" | "int" | "real" | "bool" | "json" | "blob";
type Codec<T> = { [K in keyof T]-?: ColumnType };
type Row = Record<string, unknown>;

const sqlType: Record<ColumnType, string> = { text: "TEXT", int: "INTEGER", real: "REAL", bool: "INTEGER", json: "TEXT", blob: "BLOB" };
const snake = (field: string): string => field.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const quoted = (field: string): string => `"${snake(field)}"`;

function encode(type: ColumnType, value: unknown): unknown {
  if (type === "json") return JSON.stringify(value ?? null);
  if (type === "bool") return value ? 1 : 0;
  if (type === "blob" && value instanceof Float64Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  return value;
}

function decode(type: ColumnType, value: unknown): unknown {
  if (type === "json") return JSON.parse(value as string);
  if (type === "bool") return value === 1;
  if (type === "blob" && Buffer.isBuffer(value)) return new Float64Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  return value;
}

function defineTable<T extends object>(
  db: Database.Database,
  prepare: (sql: string) => Database.Statement,
  name: string,
  key: (keyof T & string)[],
  codec: Codec<T>,
  indexes: (keyof T & string)[][] = [],
) {
  const fields = Object.keys(codec) as (keyof T & string)[];
  const columns = fields.map(quoted).join(", ");
  db.exec(`CREATE TABLE IF NOT EXISTS ${name} (${fields.map((f) => `${quoted(f)} ${sqlType[codec[f]]}`).join(", ")}, PRIMARY KEY (${key.map(quoted).join(", ")}))`);
  for (const index of indexes) {
    db.exec(`CREATE INDEX IF NOT EXISTS ${name}_${index.map(snake).join("_")} ON ${name} (${index.map(quoted).join(", ")})`);
  }
  const insert = `INSERT OR REPLACE INTO ${name} (${columns}) VALUES (${fields.map(() => "?").join(", ")})`;
  const select = `SELECT ${columns} FROM ${name}`;
  const fromRow = (row: Row): T => Object.fromEntries(fields.map((f) => [f, decode(codec[f], row[snake(f)])])) as T;
  return {
    upsert(value: T): void {
      prepare(insert).run(...fields.map((f) => encode(codec[f], value[f])));
    },
    one(clause: string, ...params: unknown[]): T | null {
      const row = prepare(`${select} ${clause}`).get(...params) as Row | undefined;
      return row === undefined ? null : fromRow(row);
    },
    many(clause: string, ...params: unknown[]): T[] {
      return (prepare(`${select} ${clause}`).all(...params) as Row[]).map(fromRow);
    },
  };
}

const reservedGridKeys = new Set(["time", "episodes"]);

export function openDb(path: string = process.env.DB_PATH ?? dbPath) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  const statements = new Map<string, Database.Statement>();
  const prepare = (sql: string): Database.Statement => {
    const cached = statements.get(sql);
    if (cached) return cached;
    const statement = db.prepare(sql);
    statements.set(sql, statement);
    return statement;
  };
  const transaction = <T>(fn: () => T): T => db.transaction(fn)();

  const runs = defineTable<Run>(db, prepare, "runs", ["id"], {
    id: "text",
    name: "text",
    domain: "text",
    status: "text",
    createdAt: "text",
    finishedAt: "text",
    rows: "int",
    columns: "int",
    sensorCount: "int",
    quarantined: "json",
    episodes: "int",
    rawBytes: "real",
    gridSize: "int",
    bucket: "int",
    timeBase: "json",
    commitHash: "text",
    templateHashes: "json",
    stages: "json",
    error: "text",
    parentRunId: "text",
  });
  const sensors = defineTable<SensorRecord>(db, prepare, "sensors", ["runId", "alias"], {
    runId: "text",
    alias: "text",
    index: "int",
    sourceName: "text",
    fingerprint: "json",
    relations: "json",
    redundancyGroup: "json",
    peers: "json",
    flowIndex: "int",
  });
  const grids = defineTable<GridRow>(db, prepare, "grids", ["runId", "alias"], { runId: "text", alias: "text", values: "blob" });
  const evidence = defineTable<Evidence>(
    db,
    prepare,
    "evidence",
    ["id"],
    { id: "text", runId: "text", kind: "text", sensors: "json", window: "json", method: "text", stats: "json", verdict: "text", chart: "json" },
    [["runId"]],
  );
  const evidenceSeries = defineTable<SeriesRow>(db, prepare, "evidence_series", ["evidenceId", "key"], { evidenceId: "text", key: "text", values: "blob" });
  const inferences = defineTable<Inference>(
    db,
    prepare,
    "inferences",
    ["id"],
    {
      id: "text",
      runId: "text",
      seq: "int",
      stage: "text",
      sensor: "text",
      claim: "text",
      confidence: "real",
      evidenceIds: "json",
      status: "text",
      supersedes: "text",
      value: "json",
    },
    [["runId", "stage"]],
  );
  const rules = defineTable<Rule>(
    db,
    prepare,
    "rules",
    ["id"],
    { id: "text", runId: "text", rule: "json", restated: "text", violations: "int", active: "bool", origin: "text", inferenceId: "text", evidenceId: "text" },
    [["runId"]],
  );
  const threads = defineTable<ThreadEntry>(
    db,
    prepare,
    "threads",
    ["id"],
    { id: "text", inferenceId: "text", time: "text", kind: "text", text: "text", evidenceIds: "json", egressId: "text" },
    [["inferenceId"]],
  );
  const log = defineTable<LogRow>(db, prepare, "log", ["seq"], { seq: "int", runId: "text", text: "text", hash: "text" }, [["runId"]]);
  const egress = defineTable<EgressRecord>(
    db,
    prepare,
    "egress",
    ["id"],
    {
      id: "text",
      runId: "text",
      time: "text",
      purpose: "text",
      mode: "text",
      provider: "json",
      payload: "text",
      payloadBytes: "int",
      guards: "json",
      templateHash: "text",
      inferenceId: "text",
      operatorText: "bool",
      status: "text",
      response: "text",
      validator: "json",
      durationMs: "real",
    },
    [["runId"]],
  );
  const settings = defineTable<SettingRow>(db, prepare, "settings", ["key"], { key: "text", value: "text" });

  return {
    raw: db,
    transaction,
    close: (): void => {
      db.close();
    },
    runs: {
      save: runs.upsert,
      get: (id: string): Run | null => runs.one("WHERE id = ?", id),
      list: (): Run[] => runs.many("ORDER BY created_at DESC, rowid DESC"),
    },
    sensors: {
      saveAll: (rows: SensorRecord[]): void => transaction(() => rows.forEach(sensors.upsert)),
      list: (runId: string): SensorRecord[] => sensors.many('WHERE run_id = ? ORDER BY "index"', runId),
      get: (runId: string, alias: string): SensorRecord | null => sensors.one("WHERE run_id = ? AND alias = ?", runId, alias),
    },
    grids: {
      save: (runId: string, grid: Grid): void =>
        transaction(() => {
          grid.aliases.forEach((alias, i) => {
            const values = grid.values[i];
            if (values) grids.upsert({ runId, alias, values });
          });
          if (grid.time) grids.upsert({ runId, alias: "time", values: grid.time });
          grids.upsert({ runId, alias: "episodes", values: Float64Array.from([...grid.episodes.map((e) => e.from), grid.n]) });
        }),
      series: (runId: string): GridSeries[] =>
        grids.many("WHERE run_id = ? ORDER BY length(alias), alias", runId).filter((row) => !reservedGridKeys.has(row.alias)),
      load(runId: string): Grid | null {
        const rows = grids.many("WHERE run_id = ? ORDER BY length(alias), alias", runId);
        const bounds = rows.find((row) => row.alias === "episodes")?.values;
        const run = runs.one("WHERE id = ?", runId);
        if (!bounds || !run) return null;
        const series = rows.filter((row) => !reservedGridKeys.has(row.alias));
        const starts = Array.from(bounds.subarray(0, bounds.length - 1));
        return {
          aliases: series.map((row) => row.alias),
          values: series.map((row) => row.values),
          n: bounds[bounds.length - 1] ?? 0,
          dt: run.timeBase.dt,
          time: rows.find((row) => row.alias === "time")?.values ?? null,
          episodes: starts.map((from, i) => ({ from, to: bounds[i + 1] ?? from, n: (bounds[i + 1] ?? from) - from })),
        };
      },
    },
    evidence: {
      saveAll: (items: Evidence[]): void => transaction(() => items.forEach(evidence.upsert)),
      saveSeries: (evidenceId: string, derived: Record<string, Float64Array>): void =>
        transaction(() => Object.entries(derived).forEach(([key, values]) => evidenceSeries.upsert({ evidenceId, key, values }))),
      get: (id: string): Evidence | null => evidence.one("WHERE id = ?", id),
      list: (runId: string): Evidence[] => evidence.many("WHERE run_id = ? ORDER BY id", runId),
      series: (evidenceId: string): Record<string, Float64Array> =>
        Object.fromEntries(evidenceSeries.many("WHERE evidence_id = ?", evidenceId).map((row) => [row.key, row.values])),
    },
    inferences: {
      save: inferences.upsert,
      saveAll: (items: Inference[]): void => transaction(() => items.forEach(inferences.upsert)),
      get: (id: string): Inference | null => inferences.one("WHERE id = ?", id),
      list: (runId: string, stage?: Stage): Inference[] =>
        stage === undefined
          ? inferences.many("WHERE run_id = ? ORDER BY seq", runId)
          : inferences.many("WHERE run_id = ? AND stage = ? ORDER BY seq", runId, stage),
    },
    rules: {
      save: rules.upsert,
      get: (id: string): Rule | null => rules.one("WHERE id = ?", id),
      list: (runId: string): Rule[] => rules.many("WHERE run_id = ? ORDER BY rowid", runId),
    },
    threads: {
      save: threads.upsert,
      list: (inferenceId: string): ThreadEntry[] => threads.many("WHERE inference_id = ? ORDER BY rowid", inferenceId),
    },
    log: {
      insert: log.upsert,
      head: (): LogRow | null => log.one("ORDER BY seq DESC LIMIT 1"),
      list: (runId?: string): LogRow[] => (runId === undefined ? log.many("ORDER BY seq") : log.many("WHERE run_id = ? ORDER BY seq", runId)),
    },
    egress: {
      save: egress.upsert,
      get: (id: string): EgressRecord | null => egress.one("WHERE id = ?", id),
      list: (runId?: string): EgressRecord[] =>
        runId === undefined ? egress.many("ORDER BY time DESC, rowid DESC") : egress.many("WHERE run_id = ? ORDER BY time DESC, rowid DESC", runId),
      newestOffRunId(): string | null {
        const row = prepare(
          "SELECT e.run_id AS run_id FROM egress e JOIN runs r ON r.id = e.run_id GROUP BY e.run_id HAVING SUM(e.status != 'off') = 0 ORDER BY MAX(r.created_at) DESC LIMIT 1",
        ).get() as { run_id: string } | undefined;
        return row?.run_id ?? null;
      },
    },
    settings: {
      get: (key: string): string | null => settings.one('WHERE "key" = ?', key)?.value ?? null,
      set: (key: string, value: string): void => settings.upsert({ key, value }),
    },
  };
}

export type Db = ReturnType<typeof openDb>;
