import type { Locator, SourceKind, SourceStatus } from "@tpm/schemas";

export type SegmentDraft = { text: string; speaker: string | null; locator: Locator; block: number };

export type Normalized = {
  title: string;
  kind: SourceKind;
  occurredAt: string | null;
  status: Extract<SourceStatus, "processed" | "needs_ocr" | "sensor_data">;
  segments: SegmentDraft[];
  headers: string[];
  attachments: Attachment[];
  ocrPages: number[];
};

export type Attachment = { name: string; mediaType: string; content: Buffer };

export type ChunkDraft = { text: string; locator: Locator; tokens: number; segmentFrom: number; segmentTo: number };
