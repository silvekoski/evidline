import { z } from "zod";
import { send } from "../providers/transport";
import { normalize, type Embedder } from "./embedder";

export type OpenAiEmbedConfig = { url: string; key: string; model: string; dims: number };

export const EMBED_BATCH = 32;
const queryInstruction = "Instruct: Given a question about the meaning of industrial process data, retrieve passages that answer it\nQuery: ";
const response = z.object({ data: z.array(z.object({ index: z.number().int(), embedding: z.array(z.number()) })) });
const retryDelays = [2000, 5000, 10000];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function post(cfg: OpenAiEmbedConfig, input: string[]): Promise<number[][]> {
  const body = JSON.stringify({ model: cfg.model, input });
  for (let attempt = 0; ; attempt++) {
    const res = await send(cfg.url, { headers: { "content-type": "application/json", authorization: `Bearer ${cfg.key}` }, body });
    if (res.status === 429 && attempt < retryDelays.length) {
      await sleep(retryDelays[attempt]!);
      continue;
    }
    if (res.status < 200 || res.status >= 300) throw new Error(`embeddings ${res.status}: ${res.text.slice(0, 300)}`);
    const parsed = response.safeParse(JSON.parse(res.text));
    if (!parsed.success) throw new Error(`embeddings response has no data[].embedding: ${res.text.slice(0, 300)}`);
    return parsed.data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }
}

export function createOpenAiEmbedder(cfg: OpenAiEmbedConfig): Embedder {
  return {
    name: "openai-embeddings",
    model: cfg.model,
    host: new URL(cfg.url).host,
    dims: cfg.dims,
    async embed(texts, kind) {
      const input = kind === "query" ? texts.map((t) => `${queryInstruction}${t}`) : texts;
      const out: Float32Array[] = [];
      for (let i = 0; i < input.length; i += EMBED_BATCH) {
        for (const full of await post(cfg, input.slice(i, i + EMBED_BATCH))) {
          if (full.length < cfg.dims) throw new Error(`embedding has ${full.length} dimensions, expected at least ${cfg.dims}`);
          out.push(normalize(Float32Array.from(full.slice(0, cfg.dims))));
        }
      }
      return out;
    },
  };
}
