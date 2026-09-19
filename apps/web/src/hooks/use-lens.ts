import { lenses, type Lens } from "@tpm/schemas";
import { useRun } from "./use-run";

export function useLens(): Lens {
  const run = useRun();
  return lenses[run.data?.domain ?? "stream"];
}
