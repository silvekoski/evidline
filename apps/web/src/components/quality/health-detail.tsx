import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { CircleIcon, CircleOffIcon } from "lucide-react";
import { cn } from "cn";
import type { BaselineInference, HealthInference, HealthValue, Run } from "@tpm/schemas";
import { getEvidence, getEvidenceSeries, getSensor, keys } from "@/api";
import { ActionBar } from "@/components/action-bar";
import { DataTable } from "@/components/data-table";
import { chartSummary, EvidenceChart } from "@/components/evidence-chart";
import { openEvidence } from "@/hooks/use-evidence-sheet";
import { useLens } from "@/hooks/use-lens";
import { screenPath } from "@/layout/screens";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBytes, formatNumber } from "@/lib/format";
import { percent } from "./signal-lane";

type Check = HealthValue["checks"][number];

export function checkMargin(c: Check): number | null {
  if (c.threshold === 0 || c.statistic === 0) return null;
  const failsAbove = c.pass ? c.statistic <= c.threshold : c.statistic > c.threshold;
  return failsAbove ? c.statistic / c.threshold : c.threshold / c.statistic;
}

function MarginBar({ margin, pass }: { margin: number | null; pass: boolean }) {
  if (margin === null) return <span className="text-xs text-muted-foreground">n/a</span>;
  return (
    <span className="inline-flex items-center gap-2">
      <span className="relative inline-block h-2 w-16 rounded-xs bg-muted" aria-hidden="true">
        <span className={cn("absolute inset-y-0 left-0 rounded-xs", pass ? "bg-muted-foreground/60" : "bg-foreground")} style={{ width: `${Math.min(100, (margin / 2) * 100)}%` }} />
        <span className="absolute -inset-y-0.5 left-1/2 w-0.5 bg-foreground" />
      </span>
      <span className="font-mono text-xs tabular-nums">{formatNumber(margin)}</span>
    </span>
  );
}

const checkColumns: ColumnDef<Check>[] = [
  { accessorKey: "check", header: "Check", cell: ({ row }) => <span className={cn("font-mono", !row.original.pass && "font-medium")}>{row.original.check}</span> },
  {
    id: "result",
    accessorFn: (c) => (c.pass ? 1 : 0),
    header: "Result",
    cell: ({ row }) =>
      row.original.pass ? (
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <CircleIcon className="size-3.5" aria-hidden="true" />
          pass
        </span>
      ) : (
        <span className="inline-flex items-center gap-1">
          <CircleOffIcon className="size-3.5" aria-hidden="true" />
          fail
        </span>
      ),
  },
  {
    id: "margin",
    accessorFn: (c) => checkMargin(c) ?? -1,
    header: "Margin",
    cell: ({ row }) => <MarginBar margin={checkMargin(row.original)} pass={row.original.pass} />,
  },
  { accessorKey: "statistic", header: "Statistic", meta: { numeric: true }, cell: ({ row }) => formatNumber(row.original.statistic) },
  { accessorKey: "threshold", header: "Threshold", meta: { numeric: true }, cell: ({ row }) => formatNumber(row.original.threshold) },
];

function ChainItem({ step, opens, id, children }: { step: string; opens: ReactNode; id: ReactNode; children: ReactNode }) {
  return (
    <li className="relative grid grid-cols-[14px_1fr] gap-x-3 py-1.5 before:absolute before:top-0 before:bottom-0 before:content-[''] before:left-[6px] before:border-l before:border-border first:before:top-4 last:before:bottom-auto last:before:h-4">
      <span className="relative z-10 mt-1.5 size-3 rounded-full border-2 border-foreground bg-background" aria-hidden="true" />
      <div className="flex flex-col">
        <span className="text-xs text-muted-foreground">
          {step} <span className="ml-1">{opens}</span>
        </span>
        <span className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <span className="font-mono text-xs">{id}</span>
          <span className="text-sm text-muted-foreground">{children}</span>
        </span>
      </div>
    </li>
  );
}

const link = "underline-offset-4 hover:underline";

export function HealthDetail({ inference, baseline, run, label }: { inference: HealthInference; baseline: BaselineInference; run: Run; label: (sample: number) => string }) {
  const lens = useLens();
  const evidenceId = inference.evidenceIds[0]!;
  const evidence = useQuery({ queryKey: keys.evidence(evidenceId), queryFn: () => getEvidence(evidenceId) });
  const series = useQuery({ queryKey: keys.evidenceSeries(evidenceId), queryFn: () => getEvidenceSeries(evidenceId) });
  const sensor = useQuery({ queryKey: keys.sensor(run.id, inference.value.sensor), queryFn: () => getSensor(run.id, inference.value.sensor) });
  const alias = inference.value.sensor;
  const fp = sensor.data?.fingerprint;
  const stats = evidence.data?.stats ?? {};
  const failed = inference.value.checks.filter((c) => !c.pass);
  const checks = [...failed, ...inference.value.checks.filter((c) => c.pass)];

  return (
    <div className="flex flex-col gap-4">
      <p>{inference.claim}</p>
      <figure className="flex flex-col gap-1">
        {evidence.data && series.data ? (
          <>
            <EvidenceChart spec={evidence.data.chart} series={series.data} label={label} />
            <figcaption className="text-xs text-muted-foreground">{chartSummary(evidence.data.chart, label)}</figcaption>
          </>
        ) : evidence.isError || series.isError ? (
          <p className="text-sm text-muted-foreground">Chart not available: {(evidence.error ?? series.error)?.message}</p>
        ) : (
          <Skeleton className="h-56 w-full" />
        )}
      </figure>
      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-labelledby={`${inference.id}-chain`} className="flex flex-col gap-1">
          <h3 id={`${inference.id}-chain`} className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Where this data comes from
          </h3>
          <ol className="flex flex-col">
            <ChainItem step="File" opens={<Link to="/runs" className={link}>opens Runs</Link>} id={run.name}>
              {run.rows.toLocaleString("en-US")} rows, {run.columns} columns, {formatBytes(run.rawBytes)}
            </ChainItem>
            <ChainItem step="Column" opens={<Link to={screenPath(run.id, "sensors", alias)} className={link}>opens {lens.sensors}</Link>} id={sensor.data?.sourceName ?? <Skeleton className="inline-block h-3 w-16" />}>
              {sensor.data ? `index ${sensor.data.index} in the file, alias ${alias}` : ""}
            </ChainItem>
            <ChainItem step="Fingerprint" opens={<Link to={screenPath(run.id, "sensors", alias)} className={link}>opens {lens.sensors}</Link>} id={fp ? `p50 ${formatNumber(fp.quantiles.p50)}, MAD ${formatNumber(fp.mad)}` : ""}>
              {fp ? `hold ${fp.hold}, flat share ${percent(fp.flatShare)}, missing ${percent(fp.missingRate)}` : ""}
            </ChainItem>
            <ChainItem step="Baseline" opens={<a href={`#${baseline.id}`} className={link}>opens the gate setup</a>} id={`[${baseline.value.window.from}, ${baseline.value.window.to})`}>
              {baseline.value.window.n.toLocaleString("en-US")} samples
              {evidence.data?.chart.band ? `, ${evidence.data.chart.band.label} ${formatNumber(evidence.data.chart.band.lo)} to ${formatNumber(evidence.data.chart.band.hi)}` : ""}
            </ChainItem>
            <ChainItem step="Health gate" opens={<a href={`#${baseline.id}`} className={link}>opens the gate setup</a>} id={evidence.data ? `method ${evidence.data.method}` : ""}>
              {Object.entries(stats)
                .map(([k, v]) => `${k} ${k === "share" ? percent(v) : formatNumber(v)}`)
                .join(", ")}
            </ChainItem>
            <ChainItem
              step="Evidence"
              opens={
                <button type="button" onClick={() => openEvidence(evidenceId)} className={link}>
                  opens the evidence sheet
                </button>
              }
              id={evidenceId}
            >
              {evidence.data?.verdict ?? ""}
            </ChainItem>
            <ChainItem step="Inference" opens={<Link to={screenPath(run.id, "log", inference.id)} className={link}>opens Log</Link>} id={inference.id}>
              seq {inference.seq}, {inference.status}, confidence {inference.confidence.toFixed(2)}
            </ChainItem>
          </ol>
        </section>
        <section aria-labelledby={`${inference.id}-checks`} className="flex flex-col gap-1">
          <h3 id={`${inference.id}-checks`} className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Checks on {alias} <span className="normal-case tracking-normal">failed first, margin above 1 is a fail</span>
          </h3>
          <DataTable label={`Checks of ${alias}`} columns={checkColumns} data={checks} getRowId={(c) => c.check} />
        </section>
      </div>
      <ActionBar inference={inference} />
    </div>
  );
}
