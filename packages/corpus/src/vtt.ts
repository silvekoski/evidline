import type { SegmentDraft } from "./types";

export type Cue = { startMs: number; endMs: number; speaker: string | null; text: string };

const timeRe = /^(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{3})$/;
const voiceRe = /^<v\s+([^>]+)>([\s\S]*?)(?:<\/v>)?$/;

export function parseTimestamp(text: string): number | null {
  const m = timeRe.exec(text.trim());
  if (!m) return null;
  return ((Number(m[1] ?? 0) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number(m[4]);
}

export function parseVtt(text: string): Cue[] {
  const cues: Cue[] = [];
  const blocks = text.replace(/\r\n?/g, "\n").split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.trim().length > 0);
    const timingIndex = lines.findIndex((l) => l.includes("-->"));
    if (timingIndex < 0) continue;
    const [start, end] = lines[timingIndex]!.split("-->").map((s) => s.trim().split(/\s+/)[0] ?? "");
    const startMs = parseTimestamp(start ?? "");
    const endMs = parseTimestamp(end ?? "");
    if (startMs === null || endMs === null) continue;
    const body = lines.slice(timingIndex + 1).join(" ").trim();
    const voice = voiceRe.exec(body);
    const speaker = voice?.[1]?.trim() ?? null;
    const spoken = (voice ? voice[2]! : body).replace(/<[^>]+>/g, "").trim();
    if (spoken.length > 0) cues.push({ startMs, endMs, speaker, text: spoken });
  }
  return cues;
}

const turnGapMs = 2000;

export function speakerTurns(cues: Cue[]): SegmentDraft[] {
  const turns: SegmentDraft[] = [];
  for (const cue of cues) {
    const last = turns.at(-1);
    const locator = last?.locator;
    if (last && locator?.kind === "teams_call" && last.speaker === cue.speaker && cue.startMs - locator.endMs <= turnGapMs) {
      last.text = `${last.text} ${cue.text}`;
      locator.endMs = cue.endMs;
    } else {
      turns.push({ text: cue.text, speaker: cue.speaker, block: 0, locator: { kind: "teams_call", startMs: cue.startMs, endMs: cue.endMs, speaker: cue.speaker } });
    }
  }
  return turns;
}

export const formatMs = (ms: number): string => {
  const s = Math.floor(ms / 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
};
