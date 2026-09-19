import type { QualityReport } from "@tpm/schemas";
import { useLens } from "@/hooks/use-lens";
import { maskShare, percent } from "./signal-lane";

function Tile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border px-3 py-2">
      <span className="text-[11px] tracking-wide text-muted-foreground uppercase">{label}</span>
      <span className="font-mono text-xl font-medium tabular-nums">
        {value}
        {detail && <span className="ml-1 text-sm font-normal text-muted-foreground">{detail}</span>}
      </span>
    </div>
  );
}

export function QualitySummary({ report, gridSize }: { report: QualityReport; gridSize: number }) {
  const lens = useLens();
  const total = report.checks.length;
  const masked = report.checks.filter((c) => c.value.health !== "healthy").length;
  const share = maskShare(
    report.checks.flatMap((c) => c.value.masked),
    gridSize,
  );
  const active = report.rules.filter((r) => r.active).length;
  const verdict = masked === 0 ? `All ${total} ${lens.sensors} pass the health gate.` : `The health gate masked ${masked} of ${total} ${lens.sensors}. ${percent(share)} of the run has at least one mask.`;
  return (
    <section aria-label="Quality summary" className="flex flex-col gap-3">
      <p className="text-base font-medium">{verdict}</p>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Tile label="Healthy" value={String(total - masked)} detail={`of ${total}`} />
        <Tile label={`Masked ${lens.sensors}`} value={String(masked)} />
        <Tile label="Run under a mask" value={percent(share)} />
        <Tile label="Active rules" value={String(active)} detail={`of ${report.rules.length}`} />
      </div>
    </section>
  );
}
