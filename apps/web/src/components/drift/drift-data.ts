import type { ChartSpec, DriftInference, DriftValue, EvidenceSeries } from "@tpm/schemas";
import { useEvidenceOfKind, type LineEvidence } from "@/hooks/use-evidence-of-kind";

export function inRangeLine(value: DriftValue): string {
  const drift = value.drifting ? "drift found" : "no drift";
  return value.inRange ? `In range, no alarm, ${drift}` : `Out of range, ${drift}`;
}

export const deviationKey = (value: DriftValue) => (value.method === "distribution" ? "distance" : "deviation");

export const deviationLimit = (spec: ChartSpec | undefined): number | null =>
  spec?.threshold ?? null;

export function useResidual(inference: DriftInference): LineEvidence {
  return useEvidenceOfKind(inference.evidenceIds, inference.value.method === "distribution" ? "distribution" : "residual");
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
