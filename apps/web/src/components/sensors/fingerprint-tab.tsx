import type { ChartSpec, Fingerprint } from "@tpm/schemas";
import { EvidenceChart } from "@/components/evidence-chart";
import { formatNumber } from "@/lib/format";
import { formatDuration } from "./duration";

const percent = (x: number) => `${(x * 100).toFixed(1)} %`;

export function FingerprintTab({ alias, fingerprint, label, dt }: { alias: string; fingerprint: Fingerprint; label: (sample: number) => string; dt: number | null }) {
  const f = fingerprint;
  const samples = (n: number) => formatDuration(n, dt);
  const rows: [string, string][] = [
    ["Samples", formatNumber(f.n)],
    ["Missing rate", percent(f.missingRate)],
    ["Distinct values", formatNumber(f.distinct)],
    ["Signal type", f.signalType],
    ["p1", formatNumber(f.quantiles.p1)],
    ["p5", formatNumber(f.quantiles.p5)],
    ["p25", formatNumber(f.quantiles.p25)],
    ["p50", formatNumber(f.quantiles.p50)],
    ["p75", formatNumber(f.quantiles.p75)],
    ["p95", formatNumber(f.quantiles.p95)],
    ["p99", formatNumber(f.quantiles.p99)],
    ["MAD", formatNumber(f.mad)],
    ["Step", formatNumber(f.step)],
    ["Noise", formatNumber(f.noise)],
    ["Hold", samples(f.hold)],
    ["ACF time", samples(f.acfTime)],
    ["Period", f.period === null ? "none" : samples(f.period)],
    ["Flat share", percent(f.flatShare)],
    ["Monotonic share", percent(f.monotonicShare)],
  ];
  const { edges, shares } = f.histogram;
  const top = shares.reduce((best, share, i) => (share > (shares[best] ?? 0) ? i : best), 0);
  const spec: ChartSpec = {
    type: "histogram",
    window: { from: 0, to: f.n, n: f.n },
    series: [],
    histograms: [{ label: alias, edges, shares }],
  };
  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr_auto_1fr]">
        {rows.map(([term, value]) => (
          <div key={term} className="contents">
            <dt className="text-muted-foreground">{term}</dt>
            <dd className="text-right font-mono tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      {shares.length > 0 && (
        <figure className="flex flex-col gap-2">
          <EvidenceChart spec={spec} series={undefined} label={label} />
          <figcaption className="text-xs text-muted-foreground">
            Histogram of {alias} with {shares.length} bins from p1 {formatNumber(f.quantiles.p1)} to p99 {formatNumber(f.quantiles.p99)}, plus one edge bin on each side. The largest bin holds{" "}
            {percent(shares[top] ?? 0)} of the samples between {formatNumber(edges[top] ?? 0)} and {formatNumber(edges[top + 1] ?? 0)}.
          </figcaption>
        </figure>
      )}
    </div>
  );
}
