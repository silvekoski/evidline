import { useQueries, useQuery } from "@tanstack/react-query";
import type { Evidence, EvidenceKind, EvidenceSeries } from "@tpm/schemas";
import { getEvidence, getEvidenceSeries, keys } from "@/api";

export type LineEvidence = { evidence: Evidence | undefined; series: EvidenceSeries | undefined; error: Error | null };

export function useEvidenceOfKind(ids: string[], kind: EvidenceKind): LineEvidence {
  const evidence = useQueries({
    queries: ids.map((id) => ({ queryKey: keys.evidence(id), queryFn: () => getEvidence(id), staleTime: Infinity })),
  });
  let found: Evidence | undefined;
  for (const q of evidence) {
    if (q.isPending) break;
    if (q.data?.kind === kind && q.data.chart.type === "line") {
      found = q.data;
      break;
    }
  }
  const series = useQuery({
    queryKey: keys.evidenceSeries(found?.id ?? ""),
    queryFn: () => getEvidenceSeries(found?.id ?? ""),
    enabled: found !== undefined,
    staleTime: Infinity,
  });
  const settled = evidence.every((q) => !q.isPending);
  const error = series.error ?? evidence.find((q) => q.error)?.error ?? (settled && !found ? new Error(`No ${kind} evidence on this inference.`) : null);
  return { evidence: found, series: series.data, error };
}
