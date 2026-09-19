import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "react-router";
import { StethoscopeIcon } from "lucide-react";
import { faultFamily, type DiagnosisInference, type FaultFamily } from "@tpm/schemas";
import { getIncidents, getSensors, keys } from "@/api";
import { useActiveRunId } from "@/hooks/use-active-run-id";
import { useHeadId } from "@/hooks/use-head-id";
import { useLens } from "@/hooks/use-lens";
import { useRun } from "@/hooks/use-run";
import { useTimeBase } from "@/hooks/use-time-base";
import { EmptyState } from "@/components/empty-state";
import { IncidentCard } from "@/components/diagnosis/incident-card";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

type Sort = "onset" | "family";

const familyOrder: Record<FaultFamily, number> = { sensor: 0, process: 1, data: 2 };
const onsetOf = (incident: DiagnosisInference) => incident.value.onset ?? incident.value.window.from;

function mentions(incident: DiagnosisInference, alias: string): boolean {
  return incident.sensor === alias || incident.value.ranked.some((r) => r.sensor === alias) || incident.value.excluded.includes(alias);
}

export function DiagnosisScreen() {
  const runId = useActiveRunId() ?? "";
  const run = useRun();
  const lens = useLens();
  const label = useTimeBase(run.data);
  const { hash } = useLocation();
  const [sort, setSort] = useState<Sort>("onset");
  const active = run.data?.status === "running" || run.data?.status === "queued";
  const incidents = useQuery({
    queryKey: keys.incidents(runId),
    queryFn: () => getIncidents(runId),
    enabled: runId !== "",
    refetchInterval: active ? 2000 : false,
  });
  const sensors = useQuery({ queryKey: keys.sensors(runId), queryFn: () => getSensors(runId), enabled: runId !== "" });
  const health = new Map((sensors.data?.sensors ?? []).map((s) => [s.alias, s.health]));

  const list = incidents.data?.incidents ?? [];
  const target = useHeadId(hash.slice(1), incidents.data !== undefined && !list.some((i) => i.id === hash.slice(1)));
  const current = list.find((i) => i.id === target) ?? list.find((i) => mentions(i, target)) ?? null;
  const highlight = current && current.id !== target ? target : null;

  useEffect(() => {
    if (!current) return;
    const card = document.getElementById(current.id);
    card?.scrollIntoView({ block: "start" });
    card?.focus({ preventScroll: true });
  }, [current?.id]);

  const sorted = [...list].sort((a, b) =>
    sort === "family"
      ? familyOrder[faultFamily(a.value.faultClass)] - familyOrder[faultFamily(b.value.faultClass)] || onsetOf(a) - onsetOf(b)
      : onsetOf(a) - onsetOf(b) || a.seq - b.seq,
  );

  return (
    <>
      <PageHeader title="Diagnosis" description={`Each incident names a fault class, ranks the ${lens.sensors} by contribution and shows the tests behind the verdict.`}>
        <span id="incident-sort-label" className="text-xs text-muted-foreground">
          Sort by
        </span>
        <ToggleGroup type="single" variant="outline" size="sm" spacing={0} value={sort} onValueChange={(value) => value && setSort(value as Sort)} aria-labelledby="incident-sort-label">
          <ToggleGroupItem value="onset">Onset</ToggleGroupItem>
          <ToggleGroupItem value="family">Family</ToggleGroupItem>
        </ToggleGroup>
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {list.length} incident{list.length === 1 ? "" : "s"}
        </p>
      </PageHeader>
      {incidents.isPending ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-96 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      ) : incidents.isError ? (
        <EmptyState icon={StethoscopeIcon} title="Diagnosis not available" description={incidents.error.message} />
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={StethoscopeIcon}
          title="No incidents"
          description={active ? "The run is still in progress. Incidents appear when fault separation finishes." : `The health gate and the drift detector found no fault in this run. Every ${lens.sensor} stays consistent with its peers.`}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {sorted.map((incident) => (
            <IncidentCard
              key={incident.id}
              incident={incident}
              label={label}
              current={incident.id === current?.id}
              highlight={incident.id === current?.id ? highlight : null}
              healthOf={(alias) => health.get(alias)}
            />
          ))}
        </div>
      )}
    </>
  );
}
