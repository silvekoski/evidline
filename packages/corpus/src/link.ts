import { mentionedColumn, type ColumnCandidate } from "./extract-local";
import { normalizeText } from "./tokens";

export const LINK_THRESHOLD = 0.75;
export const ALIAS_SCORE = 1;
export const NAME_SCORE = 0.6;

export type LinkColumn = ColumnCandidate & { id: number; vector: Float32Array | null };
export type LinkCandidate = { columnId: number; score: number };

export const cosine = (a: Float32Array, b: Float32Array): number => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
};

export function linkClaim(statement: string, statementVector: Float32Array | null, namedColumn: string | null, columns: LinkColumn[]): LinkCandidate[] {
  const text = normalizeText(statement);
  const scores = new Map<number, number>();
  const add = (id: number, score: number) => scores.set(id, (scores.get(id) ?? 0) + score);
  for (const column of columns) {
    if (namedColumn !== null && (column.name === namedColumn || column.alias === namedColumn)) add(column.id, ALIAS_SCORE);
    else if (column.phrases.some((p) => text.includes(normalizeText(p)))) add(column.id, ALIAS_SCORE);
    else if (mentionedColumn(statement, [{ ...column, phrases: [] }])) add(column.id, NAME_SCORE);
    if (statementVector && column.vector) add(column.id, Math.max(0, cosine(statementVector, column.vector)));
  }
  return [...scores.entries()]
    .map(([columnId, score]) => ({ columnId, score: Math.round(score * 1000) / 1000 }))
    .filter((c) => c.score >= LINK_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}
