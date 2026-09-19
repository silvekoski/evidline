import { z } from "zod";
import { send } from "../providers/transport";
import { embeddingsUrl } from "./openai-embedder";

export type OcrReader = { name: string; model: string; host: string; read(image: Buffer, mediaType: string): Promise<string> };
export type OcrConfig = { url: string; key: string; model: string };

export const OCR_DEFAULT_MODEL = "Qwen/Qwen3-VL-32B-Instruct";
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export const ocrPrompt = [
  "Transcribe all text on this page exactly as written, in reading order.",
  "Keep paragraphs separated by a blank line. Keep table rows on one line with cells separated by a semicolon.",
  "Do not describe images, do not translate, do not add commentary. If the page has no text, reply with an empty string.",
].join(" ");

const response = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1) });

export const chatUrl = (url: string): string => `${embeddingsUrl(url).replace(/\/embeddings\/?$/, "")}/chat/completions`;

export const cleanOcrText = (text: string): string => text.replace(/^\s*```[a-z]*\s*\n?/i, "").replace(/\n?\s*```\s*$/, "").trim();

export function createOpenAiOcr(cfg: OcrConfig): OcrReader {
  return {
    name: "openai-vision",
    model: cfg.model,
    host: new URL(cfg.url).host,
    async read(image, mediaType) {
      const body = JSON.stringify({
        model: cfg.model,
        temperature: 0,
        max_tokens: 4096,
        messages: [{ role: "user", content: [{ type: "text", text: ocrPrompt }, { type: "image_url", image_url: { url: `data:${mediaType};base64,${image.toString("base64")}` } }] }],
      });
      const res = await send(chatUrl(cfg.url), { headers: { "content-type": "application/json", authorization: `Bearer ${cfg.key}` }, body });
      if (res.status < 200 || res.status >= 300) throw new Error(`ocr ${res.status}: ${res.text.slice(0, 300)}`);
      const parsed = JSON.parse(res.text) as unknown;
      const error = (parsed as { error?: { message?: string } }).error;
      if (error) throw new Error(`ocr: ${error.message ?? "unknown error"}`);
      return cleanOcrText(response.parse(parsed).choices[0]!.message.content ?? "");
    },
  };
}

export function ocrFromEnv(): OcrReader | null {
  const url = process.env.TPM_OCR_URL || process.env.TPM_EMBED_URL;
  const key = process.env.TPM_OCR_KEY || process.env.TPM_EMBED_KEY;
  if (!url || !key) return null;
  return createOpenAiOcr({ url, key, model: process.env.TPM_OCR_MODEL || OCR_DEFAULT_MODEL });
}
