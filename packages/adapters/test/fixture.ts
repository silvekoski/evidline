import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "tpm-adapters-"));
}

export function writeCsv(dir: string, name: string, header: string[], rows: (string | number)[][], delimiter = ","): string {
  const path = join(dir, name);
  const lines = [header.join(delimiter), ...rows.map((row) => row.join(delimiter))];
  writeFileSync(path, lines.join("\n") + "\n");
  return path;
}

export function isoAt(t0: number, offsetMs: number): string {
  return new Date(t0 + offsetMs).toISOString();
}
