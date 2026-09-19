import { cn } from "cn";
import type { DiagnosisInference, HealthClass } from "@tpm/schemas";
import { ActionBar } from "@/components/action-bar";
import { ConfidenceBar } from "@/components/confidence-bar";
import { EvidenceChip } from "@/components/evidence-chip";
import { FaultBadge } from "@/components/fault-badge";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DiagnosisProse } from "./diagnosis-prose";
import { PcaStats } from "./pca-stats";
import { RankedTable } from "./ranked-table";
import { TraceSteps } from "./trace-steps";

export function IncidentCard({
  incident,
  label,
  current,
  highlight,
  healthOf,
}: {
  incident: DiagnosisInference;
  label: (sample: number) => string;
  current: boolean;
  highlight: string | null;
  healthOf: (alias: string) => "healthy" | HealthClass | undefined;
}) {
  const { value } = incident;
  const excluded = value.excluded.map((alias) => {
    const health = healthOf(alias);
    return health && health !== "healthy" ? `${alias} (${health})` : alias;
  });
  return (
    <Card
      id={incident.id}
      role="region"
      aria-labelledby={`${incident.id}-title`}
      aria-current={current ? "true" : undefined}
      tabIndex={-1}
      className={cn("scroll-mt-16 outline-none", current && "ring-foreground/60")}
    >
      <CardHeader>
        <CardTitle id={`${incident.id}-title`} className="flex flex-wrap items-center gap-2">
          <FaultBadge faultClass={value.faultClass} />
          <span className="font-mono text-xs font-normal text-muted-foreground">{incident.id}</span>
        </CardTitle>
        <CardDescription>{incident.claim}</CardDescription>
        <CardAction>
          <ConfidenceBar value={incident.confidence} />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Window</dt>
          <dd>
            {label(value.window.from)} to {label(value.window.to)}
            <span className="ml-1 font-mono text-xs text-muted-foreground tabular-nums">
              [{value.window.from}, {value.window.to}), {value.window.n.toLocaleString("en-US")} samples
            </span>
          </dd>
          <dt className="text-muted-foreground">Onset</dt>
          <dd>
            {value.onset === null ? (
              "not located"
            ) : (
              <>
                {label(value.onset)}
                <span className="ml-1 font-mono text-xs text-muted-foreground tabular-nums">sample {value.onset}</span>
              </>
            )}
          </dd>
          <dt className="text-muted-foreground">Excluded</dt>
          <dd>
            excluded from this diagnosis: {excluded.length === 0 ? "none" : <span className="font-mono">{excluded.join(", ")}</span>}
          </dd>
          {value.pca && (
            <>
              <dt className="text-muted-foreground">PCA</dt>
              <dd>
                <PcaStats pca={value.pca} />
              </dd>
            </>
          )}
          <dt className="text-muted-foreground">Evidence</dt>
          <dd className="flex flex-wrap gap-1">
            {incident.evidenceIds.map((id) => (
              <EvidenceChip key={id} evidenceId={id} />
            ))}
          </dd>
        </dl>
        <RankedTable ranked={value.ranked} runId={incident.runId} current={highlight} label={label} />
        <DiagnosisProse prose={value.prose} />
        <TraceSteps trace={value.trace} />
        <ActionBar inference={incident} />
      </CardContent>
    </Card>
  );
}
