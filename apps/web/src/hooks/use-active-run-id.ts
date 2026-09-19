import { useParams } from "react-router";

export function useActiveRunId(): string | null {
  return useParams().id ?? null;
}
