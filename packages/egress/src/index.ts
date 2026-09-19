export { roundPayload, roundSig } from "./round";
export { buildLeakIndex, scanForLeaks, type LeakIndex } from "./leak";
export {
  MAX_ARRAY_LENGTH,
  MAX_PAYLOAD_BYTES,
  SAMPLE_FLOOR,
  floorGuard,
  leakGuard,
  namesGuard,
  payloadGuards,
  recordGuard,
  roundingGuard,
  schemaGuard,
  sizeGuard,
  type GuardInput,
  type PayloadGuard,
} from "./guards";
export { responseSchema, templates } from "./templates";
export { fallback, fallbackMissingReason, ruleSentenceForms } from "./fallback";
export { validateProse, validateReview } from "./validator";
export {
  createGateway,
  jsonText,
  type CallContext,
  type CallResult,
  type EgressStore,
  type Gateway,
  type GatewayOptions,
  type Provider,
} from "./gateway";
export { MAX_NUMERIC_SHARE, MAX_TEXT_CHARS, numericShare, textGuard } from "./text/guard";
export { HASH_DIMS, createHashEmbedder, hashEmbed } from "./text/hash-embedder";
export { normalize, type EmbedKind, type Embedder } from "./text/embedder";
export { extractTemplate, extractTemplateHash } from "./text/extract-template";
export { ELEVENLABS_URL, MAX_AUDIO_BYTES, type Transcriber } from "./text/transcriber";
export { MAX_IMAGE_BYTES, OCR_DEFAULT_MODEL, ocrPrompt, type OcrReader } from "./text/ocr";
export {
  createTextGateway,
  embedderFromEnv,
  type EmbedderInfo,
  type ExtractInput,
  type TextEgressStore,
  type TextGateway,
  type TextGatewayOptions,
  type TextResult,
  type TranscribeInput,
  type OcrInput,
} from "./text/gateway";
