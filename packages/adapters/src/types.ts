import type { Grid } from "@tpm/core";
import type { Domain } from "@tpm/schemas";
import type { Layout } from "./detect-layout";
import type { ColumnProfile } from "./profile";

export type SourceStats = {
  rows: number;
  columns: number;
  rawBytes: number;
  quarantined: string[];
  domain: Domain;
  bucket: number;
  episodes: number;
};

export type Source = { grid: Grid; t0: number | null; sourceNames: string[]; stats: SourceStats };

export type LoadContext = {
  path: string;
  header: string[];
  sample: string[][];
  profiles: ColumnProfile[];
  layout: Layout;
  delimiter: string;
  maxGrid: number;
  rawBytes: number;
  onProgress: (rows: number) => void;
};
