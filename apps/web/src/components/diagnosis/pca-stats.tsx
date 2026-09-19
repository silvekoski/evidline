import type { DiagnosisValue } from "@tpm/schemas";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatNumber } from "@/lib/format";

const readings = {
  "spe-only": "The residual statistic is above its limit and the score statistic is inside. The relations between the sensors broke. This pattern points to a sensor fault.",
  "t2-only": "The score statistic is above its limit and the residual statistic is inside. The process moved inside its normal relations. This pattern points to a process fault.",
  both: "Both statistics are above their limits. The process moved and the relations broke.",
  none: "Both statistics are inside their limits. The PCA model did not decide this incident.",
};

export function PcaStats({ pca }: { pca: NonNullable<DiagnosisValue["pca"]> }) {
  const speHigh = pca.spe > pca.speLimit;
  const t2High = pca.t2 > pca.t2Limit;
  const reading = readings[speHigh && t2High ? "both" : speHigh ? "spe-only" : t2High ? "t2-only" : "none"];
  const rows = [
    { name: "T2", what: "score statistic", value: pca.t2, limit: pca.t2Limit, high: t2High },
    { name: "SPE", what: "residual statistic", value: pca.spe, limit: pca.speLimit, high: speHigh },
  ];
  return (
    <HoverCard openDelay={200}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          className="rounded-sm font-mono text-xs tabular-nums underline decoration-dotted underline-offset-4 hover:decoration-solid focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          aria-label={`PCA statistics. ${reading}`}
        >
          T2 {formatNumber(pca.t2)} of {formatNumber(pca.t2Limit)}, SPE {formatNumber(pca.spe)} of {formatNumber(pca.speLimit)}
        </button>
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-80 text-xs">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead scope="col" className="h-7 px-1 text-xs">Statistic</TableHead>
              <TableHead scope="col" className="h-7 px-1 text-right text-xs">Value</TableHead>
              <TableHead scope="col" className="h-7 px-1 text-right text-xs">Limit</TableHead>
              <TableHead scope="col" className="h-7 px-1 text-xs">State</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.name} className="hover:bg-transparent">
                <TableCell className="px-1 py-1">
                  <span className="font-mono">{row.name}</span> <span className="text-muted-foreground">{row.what}</span>
                </TableCell>
                <TableCell className="px-1 py-1 text-right font-mono tabular-nums">{formatNumber(row.value)}</TableCell>
                <TableCell className="px-1 py-1 text-right font-mono tabular-nums">{formatNumber(row.limit)}</TableCell>
                <TableCell className="px-1 py-1">{row.high ? "above limit" : "inside"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="mt-2 text-muted-foreground">{reading}</p>
      </HoverCardContent>
    </HoverCard>
  );
}
