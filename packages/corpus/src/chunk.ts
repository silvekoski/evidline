import type { Locator, SourceKind } from "@tpm/schemas";
import { countTokens, splitSentences } from "./tokens";
import type { ChunkDraft, SegmentDraft } from "./types";

export const CHUNK_MIN_TOKENS = 200;
export const CHUNK_MAX_TOKENS = 400;

const span = (a: Locator, b: Locator): Locator => {
  if (a.kind === "teams_call" && b.kind === "teams_call") return { ...a, endMs: b.endMs, speaker: a.speaker === b.speaker ? a.speaker : null };
  if (a.kind === "file" && b.kind === "file") return { ...a, charEnd: b.charEnd };
  if (a.kind === "email" && b.kind === "email") return { ...a, charEnd: b.charEnd };
  return a;
};

function splitLong(segment: SegmentDraft, index: number): ChunkDraft[] {
  const sentences = splitSentences(segment.text);
  const out: ChunkDraft[] = [];
  let buffer: string[] = [];
  let offset = 0;
  const flush = () => {
    if (buffer.length === 0) return;
    const text = buffer.join(" ");
    const locator = segment.locator.kind === "file" || segment.locator.kind === "email" ? { ...segment.locator, charStart: segment.locator.charStart + offset, charEnd: segment.locator.charStart + offset + text.length } : segment.locator;
    out.push({ text, locator, tokens: countTokens(text), segmentFrom: index, segmentTo: index });
    offset += text.length + 1;
    buffer = [];
  };
  for (const sentence of sentences) {
    if (countTokens([...buffer, sentence].join(" ")) > CHUNK_MAX_TOKENS) flush();
    buffer.push(sentence);
  }
  flush();
  return out;
}

export function chunkSegments(kind: SourceKind, segments: SegmentDraft[]): ChunkDraft[] {
  if (kind === "slack_thread") {
    const parent = segments[0];
    return segments.map((s, i) => {
      const text = i === 0 || !parent ? withSpeaker(s) : `${withSpeaker(parent)}\n\n${withSpeaker(s)}`;
      return { text, locator: s.locator, tokens: countTokens(text), segmentFrom: i, segmentTo: i };
    });
  }
  const out: ChunkDraft[] = [];
  let open: (ChunkDraft & { block: number }) | null = null;
  const close = () => {
    if (open) {
      const { block: _block, ...chunk } = open;
      out.push(chunk);
    }
    open = null;
  };
  segments.forEach((segment, i) => {
    const text = withSpeaker(segment);
    const tokens = countTokens(text);
    if (tokens > CHUNK_MAX_TOKENS) {
      close();
      out.push(...splitLong({ ...segment, text }, i));
      return;
    }
    const current: (ChunkDraft & { block: number }) | null = open;
    if (current && (current.tokens + tokens > CHUNK_MAX_TOKENS || current.block !== segment.block || kind === "email")) close();
    if (open === null) open = { text, locator: segment.locator, tokens, segmentFrom: i, segmentTo: i, block: segment.block };
    else {
      const o: ChunkDraft = open;
      o.text = `${o.text}\n${text}`;
      o.tokens += tokens;
      o.locator = span(o.locator, segment.locator);
      o.segmentTo = i;
    }
  });
  close();
  return out;
}

const withSpeaker = (s: SegmentDraft): string => (s.speaker ? `${s.speaker}: ${s.text}` : s.text);
