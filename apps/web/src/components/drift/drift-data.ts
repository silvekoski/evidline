import { useQueries, useQuery } from "@tanstack/react-query";
import type { ChartSpec, DriftInference, DriftValue, Evidence, EvidenceSeries } from "@tpm/schemas";
import { getEvidence, getEvidenceSeries, keys } from "@/api";

export function inRangeLine(value: DriftValue): string {
  const drift = value.drifting ? "drift found" : "no drift";
  return value.inRange ? `In range, no alarm, ${drift}` : `Out of range, ${drift}`;
}

export const deviationKey = (value: DriftValue) => (value.method === "distribution" ? "distance" : "deviation");

export const deviationLimit = (spec: ChartSpec | undefined): number | null =>
  spec?.threshold ?? null;

export type Residual = { evidence: Evidence | undefined; series: EvidenceSeries | undefined; error: Error | null };

export function useResidual(inference: DriftInference): Residual {
  const wanted = inference.value.method === "distribution" ? "distribution" : "residual";
  const evidence = useQueries({
    queries: inference.evidenceIds.map((id) => ({ queryKey: keys.evidence(id), queryFn: () => getEvidence(id), staleTime: Infinity })),
  });
  const residual = evidence.map((q) => q.data).find((e) => e?.kind === wanted && e.chart.type === "line");
  const series = useQuery({
    queryKey: keys.evidenceSeries(residual?.id ?? ""),
    queryFn: () => getEvidenceSeries(residual?.id ?? ""),
    enabled: residual !== undefined,
    staleTime: Infinity,
  });
  const settled = evidence.every((q) => !q.isPending);
  const error = series.error ?? evidence.find((q) => q.error)?.error ?? (settled && !residual ? new Error("No residual evidence on this inference.") : null);
  return { evidence: residual, series: series.data, error };
}

export function pickSeries(data: EvidenceSeries, spec: ChartSpec, name: string): (number | null)[] | null {
  const listed = [...spec.series, ...(spec.secondary ?? [])].find((s) => ("sensor" in s.source ? s.source.sensor : s.source.derived) === name);
  return (listed && data.series[listed.key]) ?? data.series[name] ?? null;
}

export function blockMedians(values: (number | null)[], t: number[], blocks: number): { t: number; v: number | null }[] {
  const size = Math.max(1, Math.ceil(values.length / blocks));
  const rows: { t: number; v: number | null }[] = [];
  for (let start = 0; start < values.length; start += size) {
    const block = values
      .slice(start, start + size)
      .filter((x): x is number => x !== null)
      .sort((a, b) => a - b);
    rows.push({ t: t[start] ?? start, v: block[Math.floor(block.length / 2)] ?? null });
  }
  return rows;
}
