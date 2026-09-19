import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { ChevronDownIcon } from "lucide-react";
import { cn } from "cn";
import type { DiagnosisInference } from "@tpm/schemas";
import { useEvidenceOfKind } from "@/hooks/use-evidence-of-kind";
import { useLens } from "@/hooks/use-lens";
import { screenPath } from "@/layout/screens";
import { ActionBar } from "@/components/action-bar";
import { ConfidenceBar } from "@/components/confidence-bar";
import { chartSummary, EvidenceChart } from "@/components/evidence-chart";
import { EvidenceChip } from "@/components/evidence-chip";
import { FaultBadge } from "@/components/fault-badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { capitalize } from "@/lib/format";
import { CrossReview } from "./cross-review";
import { DiagnosisProse } from "./diagnosis-prose";
import { PcaMeter } from "./pca-meter";
import { RankedTable } from "./ranked-table";
import { TraceSteps } from "./trace-steps";
import { WindowTrack } from "./window-track";

type Props = {
  incident: DiagnosisInference;
  runId: string;
  highlight: string | null;
  label: (sample: number) => string;
};

export function IncidentDetail({ incident, runId, highlight, label }: Props) {
  const { value } = incident;
  const lens = useLens();
  const [open, setOpen] = useState(false);
  const gated = value.ranked.length === 0;
  const step = value.trace.find((s) => s.test === (gated ? "health" : "isolation"));
  const lead = useEvidenceOfKind(step?.evidenceIds ?? incident.evidenceIds, gated ? "health" : "residual");
  const spec = lead.evidence && { ...lead.evidence.chart, series: lead.evidence.chart.series.filter((s) => s.style !== "thin") };
  const excluded = value.excluded.map((alias) =>
    gated ? (
      <span key={alias}>{alias}</span>
    ) : (
      <Link key={alias} to={{ hash: `#${alias}` }} replace className="underline-offset-4 hover:underline">
        {alias}
      </Link>
    ),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={2} className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-lg">{incident.sensor}</span>
          <FaultBadge faultClass={value.faultClass} />
          <span className="font-mono text-xs font-normal text-muted-foreground">{incident.id}</span>
        </CardTitle>
        <CardDescription>{incident.claim}</CardDescription>
        <CardAction className="flex flex-col items-end gap-2">
          <ConfidenceBar value={incident.confidence} />
          {incident.sensor && (
            <Button asChild size="sm" variant="outline">
              <Link to={screenPath(runId, "sensors", incident.sensor)}>{capitalize(lens.sensor)} report</Link>
            </Button>
          )}
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <Fact term="Onset">{value.onset === null ? "not located" : `${label(value.onset)}, sample ${value.onset.toLocaleString("en-US")}`}</Fact>
          <Fact term="Window">
            <WindowTrack window={value.window} className="mr-1 align-middle" />
            {label(value.window.from)} to {label(value.window.to)}, {value.window.n.toLocaleString("en-US")} samples
          </Fact>
          <Fact term="Excluded">
            {excluded.length === 0 ? (
              "none"
            ) : excluded.length <= 3 ? (
              <span className="flex flex-wrap gap-x-2">{excluded}</span>
            ) : (
              <Collapsible open={open} onOpenChange={setOpen} className="flex flex-wrap items-center gap-x-2">
                <span>
                  {excluded.length} {lens.sensors}
                </span>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="xs" className="-my-1">
                    {open ? "Hide" : "Show"}
                    <ChevronDownIcon aria-hidden="true" className={cn(open && "rotate-180")} />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="flex basis-full flex-wrap gap-x-2 gap-y-0.5">{excluded}</CollapsibleContent>
              </Collapsible>
            )}
          </Fact>
        </dl>
        <figure className="flex flex-col gap-2">
          {spec && lead.series ? (
            <EvidenceChart spec={spec} series={lead.series} label={label} />
          ) : lead.error ? (
            <p className="text-sm text-muted-foreground">Series not available: {lead.error.message}</p>
          ) : (
            <Skeleton className={gated ? "h-56 w-full" : "h-[23.25rem] w-full"} />
          )}
          {lead.evidence && spec && (
            <figcaption className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span>{chartSummary(spec, label)}</span>
              <EvidenceChip evidenceId={lead.evidence.id} />
            </figcaption>
          )}
        </figure>
        {!gated && (
          <div className="flex max-w-2xl flex-col gap-5">
            <Section title="PCA against the baseline model">
              {value.pca ? (
                <PcaMeter pca={value.pca} />
              ) : (
                <p className="text-sm text-muted-foreground">No PCA model. The health gate left fewer than two {lens.sensors} for it.</p>
              )}
            </Section>
            <Section title="Ranked by contribution">
              <RankedTable ranked={value.ranked} runId={runId} highlight={highlight} label={label} />
            </Section>
          </div>
        )}
        <DiagnosisProse prose={value.prose} />
        <TraceSteps trace={value.trace} />
        {!gated && <CrossReview incident={incident} />}
        <ActionBar inference={incident} />
      </CardContent>
    </Card>
  );
}

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-2">
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="font-mono tabular-nums">{children}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}
