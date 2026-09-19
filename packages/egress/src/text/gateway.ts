import { createHash } from "node:crypto";
import { ExtractResponse, type ExtractedClaim, type ModelMode, type TextEgressRow, type TranscriptionResponse } from "@tpm/schemas";
import type { Provider } from "../gateway";
import { getProvider } from "../providers/from-env";
import { createHashEmbedder } from "./hash-embedder";
import { createOpenAiEmbedder } from "./openai-embedder";
import { extractTemplate, extractTemplateHash } from "./extract-template";
import { textGuard } from "./guard";
import type { EmbedKind, Embedder } from "./embedder";
import { MAX_IMAGE_BYTES, ocrFromEnv, type OcrReader } from "./ocr";
import { MAX_AUDIO_BYTES, transcriberFromEnv, type Transcriber } from "./transcriber";

export type TextEgressStore = { write(row: Omit<TextEgressRow, "id">): void };
export type TextResult<T> = { ok: true; value: T; source: "model" | "local" } | { ok: false; reason: string };
export type EmbedderInfo = { name: string; model: string; dims: number; host: string | null };
export type ExtractInput = { chunk: string; columns: string[]; speaker: string | null };

export type TranscribeInput = { audio: Buffer; mediaType: string; language: string | null };

export type OcrInput = { image: Buffer; mediaType: string; page: number };

export type TextGateway = {
  embedder(): EmbedderInfo;
  ocr(input: OcrInput): Promise<TextResult<string>>;
  transcriber(): EmbedderInfo | null;
  transcribe(input: TranscribeInput): Promise<TextResult<TranscriptionResponse>>;
  embed(texts: string[], kind: EmbedKind): Promise<TextResult<Float32Array[]>>;
  extract(input: ExtractInput): Promise<TextResult<ExtractedClaim[]>>;
  templateHash: string;
};

export type TextGatewayOptions = {
  store: TextEgressStore;
  getMode: () => ModelMode;
  nowIso?: () => string;
  resolveEmbedder?: (mode: ModelMode) => Embedder;
  resolveProvider?: (mode: ModelMode) => Provider | null;
  resolveTranscriber?: (mode: ModelMode) => Transcriber | null;
  resolveOcr?: (mode: ModelMode) => OcrReader | null;
};

const hashEmbedder = createHashEmbedder();

export function embedderFromEnv(mode: ModelMode): Embedder {
  const { TPM_EMBED_URL: url, TPM_EMBED_KEY: key } = process.env;
  if (mode === "off" || !url || !key) return hashEmbedder;
  return createOpenAiEmbedder({ url, key, model: process.env.TPM_EMBED_MODEL || "Qwen/Qwen3-Embedding-4B", dims: Number(process.env.TPM_EMBED_DIMS) || 1024 });
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function createTextGateway(opts: TextGatewayOptions): TextGateway {
  const nowIso = opts.nowIso ?? (() => new Date().toISOString());
  const embedderFor = opts.resolveEmbedder ?? embedderFromEnv;
  const providerFor = opts.resolveProvider ?? getProvider;
  const transcriberFor = opts.resolveTranscriber ?? ((mode: ModelMode) => (mode === "off" ? null : transcriberFromEnv()));
  const ocrFor = opts.resolveOcr ?? ((mode: ModelMode) => (mode === "off" ? null : ocrFromEnv()));
  const log = (row: Omit<TextEgressRow, "id" | "time">) => opts.store.write({ time: nowIso(), ...row });

  return {
    templateHash: extractTemplateHash,
    embedder() {
      const { name, model, dims, host } = embedderFor(opts.getMode());
      return { name, model, dims, host };
    },
    async ocr({ image, mediaType, page }) {
      const mode = opts.getMode();
      const reader = ocrFor(mode);
      const base = { purpose: "ocr" as const, destination: reader?.host ?? "local", model: reader?.model ?? "none", texts: 1, bytes: image.byteLength, payloadHash: createHash("sha256").update(image).digest("hex") };
      if (reader === null) {
        const detail = mode === "off" ? "model off, the page image stays on the server" : "TPM_EMBED_KEY or TPM_OCR_KEY is not set";
        log({ ...base, status: "blocked", detail, durationMs: null });
        return { ok: false, reason: detail };
      }
      if (image.byteLength > MAX_IMAGE_BYTES) {
        log({ ...base, status: "blocked", detail: "page image over 10 MB", durationMs: null });
        return { ok: false, reason: "the page image is over 10 MB" };
      }
      const started = Date.now();
      try {
        const value = await reader.read(image, mediaType);
        log({ ...base, status: "sent", detail: `page ${page}, ${value.length} characters`, durationMs: Date.now() - started });
        return { ok: true, value, source: "model" };
      } catch (e) {
        log({ ...base, status: "error", detail: message(e), durationMs: Date.now() - started });
        return { ok: false, reason: `${reader.name} call failed: ${message(e)}` };
      }
    },
    transcriber() {
      const t = transcriberFor(opts.getMode());
      return t === null ? null : { name: t.name, model: t.model, dims: 0, host: t.host };
    },
    async transcribe({ audio, mediaType, language }) {
      const mode = opts.getMode();
      const transcriber = transcriberFor(mode);
      const base = { purpose: "transcribe" as const, destination: transcriber?.host ?? "local", model: transcriber?.model ?? "none", texts: 1, bytes: audio.byteLength, payloadHash: createHash("sha256").update(audio).digest("hex") };
      if (transcriber === null) {
        const detail = mode === "off" ? "model off, audio stays on the server" : "TPM_ELEVENLABS_KEY is not set";
        log({ ...base, status: "blocked", detail, durationMs: null });
        return { ok: false, reason: detail };
      }
      if (audio.byteLength > MAX_AUDIO_BYTES) {
        log({ ...base, status: "blocked", detail: "audio over 1 GB", durationMs: null });
        return { ok: false, reason: "the audio file is over 1 GB" };
      }
      const started = Date.now();
      try {
        const value = await transcriber.transcribe(audio, mediaType, language);
        log({ ...base, status: "sent", detail: `${value.words.length} words, language ${value.language_code ?? "unknown"}`, durationMs: Date.now() - started });
        return { ok: true, value, source: "model" };
      } catch (e) {
        log({ ...base, status: "error", detail: message(e), durationMs: Date.now() - started });
        return { ok: false, reason: `${transcriber.name} call failed: ${message(e)}` };
      }
    },
    async embed(texts, kind) {
      const embedder = embedderFor(opts.getMode());
      const payload = JSON.stringify(texts);
      const base = { purpose: "embed" as const, destination: embedder.host ?? "local", model: embedder.model, texts: texts.length, bytes: Buffer.byteLength(payload, "utf8"), payloadHash: sha256(payload) };
      const guard = textGuard(texts);
      if (!guard.pass) {
        log({ ...base, status: "blocked", detail: guard.detail, durationMs: null });
        return { ok: false, reason: `text guard failed: ${guard.detail}` };
      }
      const started = Date.now();
      try {
        const value = await embedder.embed(texts, kind);
        log({ ...base, status: embedder.host === null ? "local" : "sent", detail: guard.detail, durationMs: Date.now() - started });
        return { ok: true, value, source: embedder.host === null ? "local" : "model" };
      } catch (e) {
        log({ ...base, status: "error", detail: message(e), durationMs: Date.now() - started });
        return { ok: false, reason: `${embedder.name} call failed: ${message(e)}` };
      }
    },
    async extract(input) {
      const mode = opts.getMode();
      const provider = mode === "off" ? null : providerFor(mode);
      const payload = JSON.stringify(input);
      const base = { purpose: "extract" as const, destination: provider?.host ?? "local", model: provider?.model ?? "none", texts: 1, bytes: Buffer.byteLength(payload, "utf8"), payloadHash: sha256(payload) };
      const guard = textGuard([input.chunk]);
      if (!guard.pass) {
        log({ ...base, status: "blocked", detail: guard.detail, durationMs: null });
        return { ok: false, reason: `text guard failed: ${guard.detail}` };
      }
      if (provider === null) {
        log({ ...base, status: "local", detail: mode === "off" ? "model off, local rule" : `no provider for mode ${mode}`, durationMs: null });
        return { ok: false, reason: mode === "off" ? "model off" : `no provider configured for mode ${mode}` };
      }
      const started = Date.now();
      try {
        const text = await provider.call(payload, extractTemplate, ExtractResponse);
        const parsed = ExtractResponse.safeParse(JSON.parse(text));
        if (!parsed.success) {
          log({ ...base, status: "error", detail: `response failed the schema: ${parsed.error.issues.map((i) => i.message).join(", ")}`, durationMs: Date.now() - started });
          return { ok: false, reason: "response failed the extract schema" };
        }
        log({ ...base, status: "sent", detail: `${parsed.data.claims.length} claims`, durationMs: Date.now() - started });
        return { ok: true, value: parsed.data.claims, source: "model" };
      } catch (e) {
        log({ ...base, status: "error", detail: message(e), durationMs: Date.now() - started });
        return { ok: false, reason: `${provider.name} call failed: ${message(e)}` };
      }
    },
  };
}
