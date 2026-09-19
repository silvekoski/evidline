import { normalize, type Embedder } from "./embedder";

export const HASH_DIMS = 1024;

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function features(text: string): string[] {
  const words = text.toLowerCase().normalize("NFKC").match(/[\p{L}\p{N}_]+/gu) ?? [];
  const out: string[] = [];
  for (const word of words) {
    out.push(`w:${word}`);
    const padded = ` ${word} `;
    for (let i = 0; i + 3 <= padded.length; i++) out.push(`t:${padded.slice(i, i + 3)}`);
  }
  return out;
}

export function hashEmbed(text: string, dims: number = HASH_DIMS): Float32Array {
  const vector = new Float32Array(dims);
  const counts = new Map<string, number>();
  for (const f of features(text)) counts.set(f, (counts.get(f) ?? 0) + 1);
  for (const [f, count] of counts) {
    const h = fnv1a(f);
    const sign = (h & 1) === 0 ? 1 : -1;
    const weight = f.startsWith("w:") ? 2 : 1;
    vector[h % dims] = vector[h % dims]! + sign * weight * Math.log1p(count);
  }
  return normalize(vector);
}

export function createHashEmbedder(dims: number = HASH_DIMS): Embedder {
  return {
    name: "hash",
    model: `hashed-trigrams-${dims}`,
    host: null,
    dims,
    embed: async (texts) => texts.map((t) => hashEmbed(t, dims)),
  };
}
