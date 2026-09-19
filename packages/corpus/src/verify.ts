import { normalizeText } from "./tokens";

export const TRANSCRIPT_SIMILARITY = 0.9;

const bigrams = (text: string): Map<string, number> => {
  const out = new Map<string, number>();
  for (let i = 0; i + 2 <= text.length; i++) out.set(text.slice(i, i + 2), (out.get(text.slice(i, i + 2)) ?? 0) + 1);
  return out;
};

function dice(a: Map<string, number>, b: Map<string, number>): number {
  let shared = 0;
  let total = 0;
  for (const [g, n] of a) {
    shared += Math.min(n, b.get(g) ?? 0);
    total += n;
  }
  for (const n of b.values()) total += n;
  return total === 0 ? 0 : (2 * shared) / total;
}

export type QuoteCheck = { ok: boolean; similarity: number; method: "exact" | "similar" | "none" };

export function verifyQuote(quote: string, chunk: string, fuzzy: boolean): QuoteCheck {
  const q = normalizeText(quote);
  const c = normalizeText(chunk);
  if (q.length === 0) return { ok: false, similarity: 0, method: "none" };
  if (c.includes(q)) return { ok: true, similarity: 1, method: "exact" };
  if (!fuzzy) return { ok: false, similarity: 0, method: "none" };
  const words = c.split(" ");
  const quoteWords = q.split(" ").length;
  const target = bigrams(q);
  let best = 0;
  for (const width of [quoteWords, quoteWords + 1, Math.max(1, quoteWords - 1)]) {
    for (let i = 0; i + width <= words.length; i++) {
      const score = dice(target, bigrams(words.slice(i, i + width).join(" ")));
      if (score > best) best = score;
      if (best >= 0.999) break;
    }
  }
  return { ok: best >= TRANSCRIPT_SIMILARITY, similarity: best, method: best >= TRANSCRIPT_SIMILARITY ? "similar" : "none" };
}
