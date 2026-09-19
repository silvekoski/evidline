import { TranscriptionResponse } from "@tpm/schemas";
import { sendForm } from "../providers/transport";

export type Transcriber = {
  name: string;
  model: string;
  host: string;
  transcribe(audio: Buffer, mediaType: string, language: string | null): Promise<TranscriptionResponse>;
};

export type ElevenLabsConfig = { key: string; model: string; url: string };

export const ELEVENLABS_URL = "https://api.elevenlabs.io/v1/speech-to-text";
export const MAX_AUDIO_BYTES = 1024 * 1024 * 1024;

export function createElevenLabsTranscriber(cfg: ElevenLabsConfig): Transcriber {
  return {
    name: "elevenlabs",
    model: cfg.model,
    host: new URL(cfg.url).host,
    async transcribe(audio, mediaType, language) {
      const form = new FormData();
      form.set("model_id", cfg.model);
      form.set("diarize", "true");
      form.set("timestamps_granularity", "word");
      form.set("tag_audio_events", "false");
      if (language) form.set("language_code", language);
      form.set("file", new Blob([new Uint8Array(audio)], { type: mediaType }), "audio");
      const res = await sendForm(cfg.url, { "xi-api-key": cfg.key }, form);
      if (res.status < 200 || res.status >= 300) throw new Error(`elevenlabs ${res.status}: ${res.text.slice(0, 300)}`);
      return TranscriptionResponse.parse(JSON.parse(res.text));
    },
  };
}

export function transcriberFromEnv(): Transcriber | null {
  const key = process.env.TPM_ELEVENLABS_KEY;
  if (!key) return null;
  return createElevenLabsTranscriber({ key, model: process.env.TPM_ELEVENLABS_MODEL || "scribe_v1", url: process.env.TPM_ELEVENLABS_URL || ELEVENLABS_URL });
}
