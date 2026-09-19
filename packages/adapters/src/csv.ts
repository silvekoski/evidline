import { closeSync, createReadStream, openSync, readSync } from "node:fs";
import { parse } from "csv-parse";

export type CsvFormat = { delimiter: string; fast: boolean };

const parserOptions = { bom: true, relax_column_count: true, skip_empty_lines: true, trim: true };

export function sniffDelimiter(path: string): string {
  const fd = openSync(path, "r");
  const buffer = Buffer.alloc(1 << 20);
  const bytes = readSync(fd, buffer, 0, buffer.length, 0);
  closeSync(fd);
  const line = buffer.toString("utf8", 0, bytes).split("\n", 1)[0] ?? "";
  const counts = [",", ";", "\t", "|"].map((d) => ({ d, count: line.split(d).length - 1 }));
  return counts.reduce((best, c) => (c.count > best.count ? c : best)).d;
}

export async function readHead(path: string, limit: number, delimiter: string): Promise<string[][]> {
  const input = createReadStream(path);
  const rows: string[][] = [];
  try {
    for await (const row of input.pipe(parse({ ...parserOptions, delimiter })) as AsyncIterable<string[]>) {
      rows.push(row);
      if (rows.length > limit) break;
    }
  } finally {
    input.destroy();
  }
  return rows;
}

export async function streamRows(
  path: string,
  format: CsvFormat,
  onRow: (cells: string[]) => void,
  onProgress: (rows: number) => void,
): Promise<number> {
  let rows = 0;
  const handle = (cells: string[]): void => {
    onRow(cells);
    if ((++rows & 0xffff) === 0) onProgress(rows);
  };
  if (format.fast) {
    let rest = "";
    let header = true;
    const emit = (line: string): void => {
      const text = line.endsWith("\r") ? line.slice(0, -1) : line;
      if (header) header = false;
      else if (text !== "") handle(text.split(format.delimiter));
    };
    for await (const chunk of createReadStream(path, { encoding: "utf8", highWaterMark: 1 << 20 })) {
      const text = rest + chunk;
      let start = 0;
      for (let nl = text.indexOf("\n"); nl >= 0; nl = text.indexOf("\n", start)) {
        emit(text.slice(start, nl));
        start = nl + 1;
      }
      rest = text.slice(start);
    }
    emit(rest);
  } else {
    let header = true;
    const parser = createReadStream(path).pipe(parse({ ...parserOptions, delimiter: format.delimiter })) as AsyncIterable<string[]>;
    for await (const row of parser) {
      if (header) header = false;
      else handle(row);
    }
  }
  onProgress(rows);
  return rows;
}
