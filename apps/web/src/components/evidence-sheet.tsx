import { useQuery } from "@tanstack/react-query";
import { getEvidence, getEvidenceSeries, keys } from "@/api";
import { useEvidenceSheet, closeEvidence } from "@/hooks/use-evidence-sheet";
import { useRun } from "@/hooks/use-run";
import { useTimeBase } from "@/hooks/use-time-base";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatNumber } from "@/lib/format";
import { chartSummary, EvidenceChart } from "./evidence-chart";

export function EvidenceSheet() {
  const id = useEvidenceSheet();
  return (
    <Sheet open={id !== null} onOpenChange={(open) => !open && closeEvidence()}>
      <SheetContent className="overflow-y-auto data-[side=right]:sm:max-w-2xl">{id && <EvidenceBody id={id} />}</SheetContent>
    </Sheet>
  );
}

function EvidenceBody({ id }: { id: string }) {
  const evidence = useQuery({ queryKey: keys.evidence(id), queryFn: () => getEvidence(id) });
  const chartType = evidence.data?.chart.type;
  const needsSeries = chartType === "line" || chartType === "scatter";
  const series = useQuery({ queryKey: keys.evidenceSeries(id), queryFn: () => getEvidenceSeries(id), enabled: needsSeries });
  const run = useRun(evidence.data?.runId ?? null);
  const label = useTimeBase(run.data);
  const e = evidence.data;

  if (evidence.isError) {
    return (
      <SheetHeader>
        <SheetTitle>Evidence not found</SheetTitle>
        <SheetDescription>{evidence.error.message}</SheetDescription>
      </SheetHeader>
    );
  }
  if (!e) {
    return (
      <SheetHeader>
        <SheetTitle>Evidence</SheetTitle>
        <SheetDescription className="sr-only">Loading</SheetDescription>
        <Skeleton className="mt-4 h-56 w-full" />
      </SheetHeader>
    );
  }
  const summary = chartSummary(e.chart, label);
  return (
    <>
      <SheetHeader>
        <SheetTitle>
          {e.kind} evidence <span className="font-mono text-xs text-muted-foreground">{e.id}</span>
        </SheetTitle>
        <SheetDescription>{e.verdict}</SheetDescription>
      </SheetHeader>
      <div className="flex flex-col gap-4 px-4 pb-4">
        <figure className="flex flex-col gap-2">
          {needsSeries && !series.data ? (
            series.isError ? (
              <p className="text-sm text-muted-foreground">Series not available: {series.error.message}</p>
            ) : (
              <Skeleton className="h-56 w-full" />
            )
          ) : (
            <EvidenceChart spec={e.chart} series={series.data} label={label} />
          )}
          <figcaption className="text-xs text-muted-foreground">{summary}</figcaption>
        </figure>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Method</dt>
          <dd>{e.method}</dd>
          <dt className="text-muted-foreground">Sensors</dt>
          <dd className="font-mono">{e.sensors.join(", ")}</dd>
          <dt className="text-muted-foreground">Window</dt>
          <dd>
            {label(e.window.from)} to {label(e.window.to)}
            <span className="ml-1 font-mono text-xs text-muted-foreground">
              [{e.window.from}, {e.window.to})
            </span>
          </dd>
          <dt className="text-muted-foreground">Samples</dt>
          <dd className="font-mono">{e.window.n.toLocaleString("en-US")}</dd>
        </dl>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead scope="col" className="h-8">Statistic</TableHead>
              <TableHead scope="col" className="h-8 text-right">Value</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Object.entries(e.stats).map(([key, value]) => (
              <TableRow key={key}>
                <TableCell className="py-1 font-mono text-xs">{key}</TableCell>
                <TableCell className="py-1 text-right font-mono tabular-nums">{formatNumber(value)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
