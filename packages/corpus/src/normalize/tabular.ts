import { parse } from "csv-parse/sync";
import { read, utils } from "xlsx";
import type { SegmentDraft } from "../types";
import { fileLocator } from "./text";

export const SENSOR_NUMERIC_SHARE = 0.5;
export const TABULAR_SAMPLE_ROWS = 5000;
export const TABULAR_MAX_ROWS = 2000;

export type Sheet = { name: string; rows: string[][] };
export type TabularResult = { sensor: boolean; headers: string[]; numericShare: number; segments: SegmentDraft[] };

const numericCell = (cell: string): boolean => cell.trim() !== "" && /^[-+]?(\d+([.,]\d+)?|[.,]\d+)([eE][-+]?\d+)?$/.test(cell.trim());

export function parseCsv(text: string): Sheet {
  const body = text.replace(/^\uFEFF/, "");
  const head = body.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = [",", ";", "\t"].map((d) => ({ d, n: head.split(d).length })).sort((a, b) => b.n - a.n)[0]!.d;
  const rows = parse(body, { delimiter, relax_column_count: true, relax_quotes: true, skip_empty_lines: true, to: TABULAR_SAMPLE_ROWS }) as string[][];
  return { name: "csv", rows };
}

export function parseXlsx(buffer: Buffer): Sheet[] {
  const book = read(buffer, { type: "buffer", sheetRows: TABULAR_SAMPLE_ROWS });
  return book.SheetNames.map((name) => ({
    name,
    rows: (utils.sheet_to_json(book.Sheets[name]!, { header: 1, raw: false, defval: "" }) as unknown[][]).map((r) => r.map((c) => String(c ?? ""))),
  }));
}

export function classifySheets(sheets: Sheet[]): TabularResult {
  let numeric = 0;
  let cells = 0;
  const headers = new Set<string>();
  for (const sheet of sheets) {
    for (const h of sheet.rows[0] ?? []) if (h.trim()) headers.add(h.trim());
    for (const row of sheet.rows.slice(1)) for (const cell of row) {
      if (cell.trim() === "") continue;
      cells++;
      if (numericCell(cell)) numeric++;
    }
  }
  const numericShare = cells === 0 ? 0 : numeric / cells;
  const sensor = numericShare > SENSOR_NUMERIC_SHARE;
  const segments: SegmentDraft[] = sensor
    ? [{ text: `Sensor data file with ${headers.size} columns: ${[...headers].join(", ")}`, speaker: null, block: 0, locator: fileLocator(0, 0, null, sheets[0]?.name ?? null, 0) }]
    : sheets.flatMap((sheet, si) => {
        const header = sheet.rows[0] ?? [];
        return sheet.rows.slice(1, TABULAR_MAX_ROWS + 1).flatMap((row, ri) => {
          const text = row.map((cell, ci) => (cell.trim() ? `${header[ci]?.trim() || `column ${ci + 1}`}: ${cell.trim()}` : "")).filter(Boolean).join("; ");
          return text ? [{ text, speaker: null, block: si, locator: fileLocator(0, text.length, null, sheet.name, ri + 1) }] : [];
        });
      });
  return { sensor, headers: [...headers], numericShare, segments };
}
