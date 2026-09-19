import type { ReactNode } from "react";
import { Link } from "react-router";
import type { DriftInference } from "@tpm/schemas";
import { useClaimMarks } from "@/hooks/use-claim-marks";
import { useLens } from "@/hooks/use-lens";
import { screenPath } from "@/layout/screens";
import { ActionBar } from "@/components/action-bar";
import { ConfidenceBar } from "@/components/confidence-bar";
import { EvidenceChip } from "@/components/evidence-chip";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { capitalize, formatNumber } from "@/lib/format";
import { DriftCharts } from "./drift-charts";
import { deviationLimit, inRangeLine, useResidual } from "./drift-data";

type Props = {
  inference: DriftInference;
  runId: string;
  aliases: Set<string>;
  label: (sample: number) => string;
  dt: number | null;
};

export function DriftDetail({ inference, runId, aliases, label, dt }: Props) {
  const { value } = inference;
  const lens = useLens();
  const claimMarks = useClaimMarks(runId);
  const residual = useResidual(inference);
  const limit = deviationLimit(residual.evidence?.chart);
  const spec = residual.evidence?.chart;
  const at = (sample: number) => (dt === null ? label(sample) : `${label(sample)}, sample ${sample.toLocaleString("en-US")}`);
  const alias = (a: string) =>
    aliases.has(a) ? (
      <Link key={a} to={{ hash: `#${a}` }} replace className="underline-offset-4 hover:underline">
        {a}
      </Link>
    ) : (
      <span key={a}>{a}</span>
    );

  const summary = [
    `${value.sensor} against the expected value from ${value.peers.length} peers, ${spec ? `${label(spec.window.from)} to ${label(spec.window.to)}` : "full grid"}`,
    spec?.band ? `${spec.band.label} from ${formatNumber(spec.band.lo)} to ${formatNumber(spec.band.hi)}` : null,
    `deviation under it with ${limit !== null ? `the limit at ${formatNumber(limit)}` : "no limit"}, max deviation ${formatNumber(value.maxDeviation)}`,
    value.onset !== null ? `onset at ${label(value.onset)}` : "no onset",
  ]
    .filter((part) => part !== null)
    .join(". ");

  const rows: { term: string; detail: ReactNode; mono?: boolean }[] = [
    { term: "Onset", detail: value.onset === null ? "none" : at(value.onset) },
    { term: "Rate", detail: `${formatNumber(value.ratePer1000)} per 1000 samples` },
    { term: "Mann-Kendall Z", detail: formatNumber(value.mannKendallZ) },
    { term: "p-value", detail: value.pValue < 0.001 ? "< 0.001" : formatNumber(value.pValue) },
    { term: "Max deviation", detail: limit === null ? formatNumber(value.maxDeviation) : `${formatNumber(value.maxDeviation)} of limit ${formatNumber(limit)}` },
    { term: "Severity", detail: formatNumber(value.severity) },
    {
      term: "Detection delay",
      detail: value.detectionDelay === null ? "none" : `${value.detectionDelay.toLocaleString("en-US")} samples${dt === null ? "" : `, ${label(value.detectionDelay)}`}`,
    },
    {
      term: `Responsible ${lens.sensor}`,
      detail: value.responsible === null ? "none" : value.responsible === value.sensor ? `${value.responsible}, this ${lens.sensor}` : alias(value.responsible),
    },
    { term: "Peers", detail: value.peers.length ? <span className="flex flex-wrap gap-x-2">{value.peers.map(alias)}</span> : "none" },
    { term: "Method", detail: value.method === "peer-residual" ? "peer residual" : "distribution distance", mono: false },
    { term: "Confidence", detail: <ConfidenceBar value={inference.confidence} /> },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <span className="font-mono">{value.sensor}</span>
          {value.drifting ? <StatusBadge kind="drift" /> : <StatusBadge kind="healthy" label="No drift" />}
          <span className="font-mono text-xs font-normal text-muted-foreground">{inference.id}</span>
        </CardTitle>
        <CardDescription>{inference.claim}</CardDescription>
        <CardAction>
          <Button asChild size="sm" variant="outline">
            <Link to={screenPath(runId, "sensors", value.sensor)}>{capitalize(lens.sensor)} report</Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-base font-medium">{inRangeLine(value)}.</p>
        <figure className="flex flex-col gap-2">
          {residual.series && spec ? (
            <DriftCharts value={value} spec={spec} series={residual.series} limit={limit} label={label} claimMarks={claimMarks} />
          ) : residual.error ? (
            <p className="text-sm text-muted-foreground">Series not available: {residual.error.message}</p>
          ) : (
            <Skeleton className="h-[23.25rem] w-full" />
          )}
          <figcaption className="text-xs text-muted-foreground">{summary}.</figcaption>
        </figure>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm md:grid-cols-[auto_1fr_auto_1fr]">
          {rows.map((row) => (
            <div key={row.term} className="contents">
              <dt className="text-muted-foreground">{row.term}</dt>
              <dd className={row.mono === false ? undefined : "font-mono tabular-nums"}>{row.detail}</dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-muted-foreground">Evidence</span>
          {inference.evidenceIds.map((id) => (
            <EvidenceChip key={id} evidenceId={id} />
          ))}
        </div>
        <ActionBar inference={inference} />
      </CardContent>
    </Card>
  );
}
