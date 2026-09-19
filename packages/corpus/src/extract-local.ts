import type { ExtractedClaim } from "@tpm/schemas";
import { splitSentences } from "./tokens";

export type ColumnCandidate = { name: string; alias: string; phrases: string[] };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function mentionedColumn(sentence: string, columns: ColumnCandidate[]): ColumnCandidate | null {
  const lower = sentence.toLowerCase();
  for (const column of columns) {
    const needles = [column.name, column.alias, ...column.phrases].filter((p) => p.length >= 2).map((p) => p.toLowerCase());
    if (needles.some((needle) => new RegExp(`(^|[^\\p{L}\\p{N}_])${escape(needle)}(?=$|[^\\p{L}\\p{N}_])`, "iu").test(lower))) return column;
  }
  return null;
}

export function extractClaimsLocally(chunk: string, speaker: string | null, columns: ColumnCandidate[]): ExtractedClaim[] {
  const claims: ExtractedClaim[] = [];
  for (const line of chunk.split("\n")) {
    const turn = /^([^:\n]{1,80}):\s+(.+)$/.exec(line);
    const said = turn ? turn[2]! : line;
    const who = turn ? turn[1]! : speaker;
    for (const sentence of splitSentences(said)) {
      const column = mentionedColumn(sentence, columns);
      if (!column || sentence.length < 12 || sentence.length > 500) continue;
      claims.push({ statement: sentence.slice(0, 300), quote: sentence, speaker: who, column: column.name, provenance: "person" });
      if (claims.length === 20) return claims;
    }
  }
  return claims;
}
