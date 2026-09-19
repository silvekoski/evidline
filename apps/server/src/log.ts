import { createHash } from "node:crypto";
import { LogEntry, type LogVerification } from "@tpm/schemas";
import type { Db, LogRow } from "./db";

export type LogInput = Omit<LogEntry, "seq" | "time" | "prevHash" | "hash">;

export const genesisHash = "0".repeat(64);

const keys = Object.keys(LogEntry.shape) as (keyof LogEntry)[];
const canonicalKeys = keys.filter((k) => k !== "hash");

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

const canonical = (entry: Omit<LogEntry, "hash">): string =>
  JSON.stringify(Object.fromEntries(canonicalKeys.map((k) => [k, entry[k] ?? null])));

const entryOf = (row: LogRow): LogEntry => ({ ...(JSON.parse(row.text) as Omit<LogEntry, "hash">), hash: row.hash });

export function appendLog(db: Db, input: LogInput, time = new Date().toISOString()): LogEntry {
  return db.transaction(() => {
    const head = db.log.head();
    const entry = { ...input, seq: (head?.seq ?? 0) + 1, time, prevHash: head?.hash ?? genesisHash };
    const text = canonical(entry);
    const row = { seq: entry.seq, runId: input.runId, text, hash: sha256(entry.prevHash + text) };
    db.log.insert(row);
    return entryOf(row);
  });
}

export const listLog = (db: Db, runId?: string): LogEntry[] => db.log.list(runId).map(entryOf);

export function verifyLog(db: Db): LogVerification {
  const rows = db.log.list();
  let head = genesisHash;
  for (const row of rows) {
    const stored = LogEntry.omit({ hash: true }).safeParse(safeJson(row.text)).data;
    const linked = stored !== undefined && stored.seq === row.seq && stored.prevHash === head;
    if (!linked || sha256(head + row.text) !== row.hash) return { ok: false, entries: rows.length, firstBadSeq: row.seq, head };
    head = row.hash;
  }
  return { ok: true, entries: rows.length, firstBadSeq: null, head };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function exportLog(db: Db, format: "json" | "csv"): string {
  const entries = listLog(db);
  if (format === "json") return JSON.stringify(entries, null, 2);
  const cell = (value: unknown): string => {
    const text = typeof value === "string" ? value : value === null || value === undefined ? "" : JSON.stringify(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [keys.join(","), ...entries.map((entry) => keys.map((k) => cell(entry[k])).join(","))].join("\r\n") + "\r\n";
}
