import type { TranscriptWord } from "@tpm/schemas";
import type { SegmentDraft } from "./types";

export const TURN_GAP_S = 2;
export const TURN_MAX_CHARS = 1200;

export const audioExtensions = [".m4a", ".mp3", ".wav", ".ogg", ".oga", ".opus", ".webm", ".aac", ".flac", ".mp4"] as const;
export const isAudioName = (name: string): boolean => audioExtensions.some((ext) => name.toLowerCase().endsWith(ext));

export function wordsToTurns(words: TranscriptWord[], defaultSpeaker: string | null = null): SegmentDraft[] {
  const turns: SegmentDraft[] = [];
  let text = "";
  let speaker: string | null = null;
  let start = 0;
  let end = 0;
  const flush = () => {
    const clean = text.replace(/\s+/g, " ").trim();
    if (clean) turns.push({ text: clean, speaker, block: 0, locator: { kind: "teams_call", startMs: Math.round(start * 1000), endMs: Math.round(end * 1000), speaker } });
    text = "";
  };
  for (const w of words) {
    if (w.type === "audio_event") continue;
    if (w.type === "spacing") {
      if (text !== "") text += " ";
      continue;
    }
    const who = w.speaker_id ? `Speaker ${w.speaker_id.replace(/^speaker_/, "")}` : defaultSpeaker;
    const breakTurn = text !== "" && (who !== speaker || w.start - end > TURN_GAP_S || (text.length > TURN_MAX_CHARS && /[.!?]\s*$/.test(text)));
    if (breakTurn) flush();
    if (text === "") {
      speaker = who;
      start = w.start;
    }
    text += w.text;
    end = Math.max(end, w.end);
  }
  flush();
  return turns;
}
