import type { Window } from "@tpm/schemas";
import { healthBlockSize } from "./health";
import { median } from "./stats/quantile";
import { minSplittableSpan } from "./stats/segmentation";
import { window } from "./types";

export function minEpisodeLength(n: number): number {
  return Math.max(healthBlockSize(n), minSplittableSpan(n));
}

export function usableEpisodes(episodes: Window[], n: number): Window[] {
  if (episodes.length <= 1) return episodes;
  const lengths = Float64Array.from(episodes, (e) => e.n);
  return median(lengths) < minEpisodeLength(n) ? [window(0, n)] : episodes;
}
