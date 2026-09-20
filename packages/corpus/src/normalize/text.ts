import type { SegmentDraft } from "../types";

export const fileLocator = (charStart: number, charEnd: number, page: number | null = null, sheet: string | null = null, row: number | null = null) =>
  ({ kind: "file", page, sheet, row, charStart, charEnd }) as const;

const isTableLine = (line: string) => /^\s*\|.*\|\s*$/.test(line);
const isListLine = (line: string) => /^\s*([-*+]|\d+[.)])\s+\S/.test(line);

export function paragraphSegments(text: string, opts: { page?: number | null; block?: number; offset?: number; headings?: boolean } = {}): SegmentDraft[] {
  const clean = text.replace(/\r\n?/g, "\n");
  const out: SegmentDraft[] = [];
  let block = opts.block ?? 0;
  const re = /[^\n]+(?:\n(?!\s*\n)[^\n]+)*/g;
  for (const m of clean.matchAll(re)) {
    const lines = m[0].split("\n");
    const structured = lines.length > 1 && (lines.every(isTableLine) || lines.every(isListLine));
    const paragraph = structured ? lines.map((line) => line.replace(/[ \t]+/g, " ").trim()).join("\n") : m[0].replace(/\s+/g, " ").trim();
    if (paragraph.length === 0) continue;
    if (opts.headings && /^#{1,6}\s/.test(m[0])) block++;
    const start = (opts.offset ?? 0) + m.index;
    out.push({ text: paragraph.replace(/^#{1,6}\s+/, ""), speaker: null, block, locator: fileLocator(start, start + m[0].length, opts.page ?? null) });
  }
  return out;
}
