import { useQuery } from "@tanstack/react-query";
import { getRun, keys } from "@/api";
import { useActiveRunId } from "./use-active-run-id";

export function useRun(runId?: string | null) {
  const active = useActiveRunId();
  const id = runId ?? active;
  return useQuery({
    queryKey: keys.run(id ?? ""),
    queryFn: () => getRun(id ?? ""),
    enabled: id !== null,
    refetchInterval: (query) => (query.state.data?.status === "running" || query.state.data?.status === "queued" ? 2000 : false),
  });
}
