import { statSync } from "node:fs";
import { readHead, sniffDelimiter } from "./csv";
import { layoutFromProfiles } from "./detect-layout";
import { profileColumns } from "./profile";
import { loadRecords } from "./records-adapter";
import { loadStream } from "./stream-adapter";
import type { Source } from "./types";

export const sampleRows = 5000;
export const defaultMaxGrid = 262_144;

export async function loadSource(path: string, opts: { maxGrid?: number; onProgress?: (rows: number) => void } = {}): Promise<Source> {
  const delimiter = sniffDelimiter(path);
  const [header, ...sample] = await readHead(path, sampleRows, delimiter);
  if (header === undefined || sample.length === 0) throw new Error("the file has no data rows");
  const profiles = profileColumns(sample, header);
  const layout = layoutFromProfiles(profiles);
  const ctx = {
    path,
    header,
    sample,
    profiles,
    layout,
    delimiter,
    maxGrid: opts.maxGrid ?? defaultMaxGrid,
    rawBytes: statSync(path).size,
    onProgress: opts.onProgress ?? (() => {}),
  };
  return layout.domain === "records" ? loadRecords(ctx) : loadStream(ctx);
}
