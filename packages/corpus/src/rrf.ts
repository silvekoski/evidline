export const RRF_K = 60;

export type Fused<T> = { id: T; score: number; ranks: (number | null)[] };

export function fuseRanks<T>(lists: T[][], k: number = RRF_K): Fused<T>[] {
  const scores = new Map<T, Fused<T>>();
  lists.forEach((list, li) => {
    list.forEach((id, i) => {
      const entry = scores.get(id) ?? { id, score: 0, ranks: lists.map(() => null) };
      entry.score += 1 / (k + i + 1);
      entry.ranks[li] = i + 1;
      scores.set(id, entry);
    });
  });
  return [...scores.values()].sort((a, b) => b.score - a.score);
}
