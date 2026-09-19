import { ChevronsRightIcon } from "lucide-react";
import { cn } from "cn";
import type { DiagnosisValue } from "@tpm/schemas";
import { formatNumber } from "@/lib/format";

const cap = 4;

const readings = {
  "spe-only": "SPE is above its limit and T2 is inside. The relations between the sensors broke. This pattern points to a sensor fault.",
  "t2-only": "T2 is above its limit and SPE is inside. The process moved inside its normal relations. This pattern points to a process fault.",
  both: "T2 and SPE are above their limits. The process moved and the relations broke.",
  none: "T2 and SPE are inside their limits. The PCA model did not decide this incident.",
};

export function PcaMeter({ pca }: { pca: NonNullable<DiagnosisValue["pca"]> }) {
  const rows = [
    { name: "T2", what: "score statistic", value: pca.t2, limit: pca.t2Limit },
    { name: "SPE", what: "residual statistic", value: pca.spe, limit: pca.speLimit },
  ].map((row) => ({ ...row, ratio: row.value / row.limit }));
  const [t2, spe] = rows.map((row) => row.ratio > 1);
  const reading = readings[t2 && spe ? "both" : spe ? "spe-only" : t2 ? "t2-only" : "none"];
  return (
    <figure className="flex flex-col gap-2">
      <div className="grid grid-cols-[2.5rem_1fr_auto] items-center gap-x-3 gap-y-2 text-xs">
        <span aria-hidden="true" />
        <span aria-hidden="true" className="relative h-3">
          <span className="absolute left-1/4 -translate-x-1/2 text-[10px] text-muted-foreground">limit</span>
        </span>
        <span aria-hidden="true" />
        {rows.map((row) => (
          <div
            key={row.name}
            role="meter"
            aria-label={`${row.name}, ${row.what}`}
            aria-valuemin={0}
            aria-valuemax={cap}
            aria-valuenow={Math.min(row.ratio, cap)}
            aria-valuetext={`${formatNumber(row.value)} of limit ${formatNumber(row.limit)}, ${row.ratio > 1 ? `${formatNumber(row.ratio)} times the limit` : "inside the limit"}`}
            className="col-span-3 grid grid-cols-subgrid items-center"
          >
            <span className="font-mono">{row.name}</span>
            <span className="relative h-2.5 rounded-xs bg-muted">
              <span
                className={cn("absolute inset-y-0 left-0 rounded-xs", row.ratio > 1 ? "bg-foreground" : "bg-chart-4")}
                style={{ width: `${(Math.min(row.ratio, cap) / cap) * 100}%` }}
              />
              <span className="absolute -inset-y-1 left-1/4 border-l border-dotted border-chart-2" />
              {row.ratio > cap && <ChevronsRightIcon aria-hidden="true" className="absolute inset-y-0 right-0 size-2.5 text-background" />}
            </span>
            <span className="text-right font-mono text-muted-foreground tabular-nums">
              <span className="text-foreground">{formatNumber(row.value)}</span> of {formatNumber(row.limit)}
              {row.ratio > cap && <span className="ml-2">x{formatNumber(row.ratio)}</span>}
            </span>
          </div>
        ))}
      </div>
      <figcaption className="text-xs text-muted-foreground">{reading}</figcaption>
    </figure>
  );
}
