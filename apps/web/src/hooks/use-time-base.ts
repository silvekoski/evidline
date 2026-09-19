import { useCallback } from "react";
import type { Run } from "@tpm/schemas";

const dayMs = 86_400_000;

export function useTimeBase(run: Run | null | undefined): (sample: number) => string {
  const dt = run?.timeBase.dt ?? null;
  return useCallback(
    (sample: number) => (dt === null ? `sample ${Math.round(sample)}` : `${((sample * dt) / dayMs).toFixed(2)} d`),
    [dt],
  );
}
