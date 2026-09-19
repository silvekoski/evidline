import type { Domain } from "@tpm/schemas";
import { profileColumns, type ColumnProfile } from "./profile";

export type Layout = { domain: Domain; timeColumn: number | null; counterColumn: number | null };

export function layoutFromProfiles(profiles: ColumnProfile[]): Layout {
  const timeColumn = profiles.findIndex((p) => p.kind === "timestamp");
  const counterColumn = profiles.findIndex((p) => p.kind === "counter");
  const time = profiles[timeColumn];
  const domain: Domain = time !== undefined && !time.regular ? "records" : "stream";
  return { domain, timeColumn: timeColumn < 0 ? null : timeColumn, counterColumn: counterColumn < 0 ? null : counterColumn };
}

export function detectLayout(sample: string[][], header: string[]): Layout {
  return layoutFromProfiles(profileColumns(sample, header));
}
