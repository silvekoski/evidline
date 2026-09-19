import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "react-router";
import { StethoscopeIcon } from "lucide-react";
import { faultFamily, type DiagnosisInference, type FaultFamily } from "@tpm/schemas";
import { getIncidents, keys } from "@/api";
import { useActiveRunId } from "@/hooks/use-active-run-id";
import { useHeadId } from "@/hooks/use-head-id";
import { useLens } from "@/hooks/use-lens";
import { useRun } from "@/hooks/use-run";
import { useTimeBase } from "@/hooks/use-time-base";
import { EmptyState } from "@/components/empty-state";
import { IncidentCard } from "@/components/diagnosis/incident-card";
import { IncidentDetail } from "@/components/diagnosis/incident-detail";
import { PageHeader } from "@/components/page-header";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

type Sort = "onset" | "family";

const familyOrder: Record<FaultFamily, number> = { sensor: 0, process: 1, data: 2 };
const onsetOf = (incident: DiagnosisInference) => incident.value.onset ?? incident.value.window.from;

function mentions(incident: DiagnosisInference, alias: string): boolean {
  return incident.value.ranked.some((r) => r.sensor === alias) || incident.value.excluded.includes(alias);
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

  const list = incidents.data?.incidents ?? [];
  const sorted = [...list].sort((a, b) =>
    sort === "family"
      ? familyOrder[faultFamily(a.value.faultClass)] - familyOrder[faultFamily(b.value.faultClass)] || onsetOf(a) - onsetOf(b)
      : onsetOf(a) - onsetOf(b) || a.seq - b.seq,
  );
  const target = useHeadId(hash.slice(1), incidents.data !== undefined && !list.some((i) => i.id === hash.slice(1)));
  const selected =
    list.find((i) => i.id === target) ??
    list.find((i) => i.sensor === target) ??
    list.find((i) => i.value.ranked.length === 0 && i.value.excluded.includes(target)) ??
    list.find((i) => mentions(i, target)) ??
    sorted[0];
  const highlight = selected && selected.id !== target && mentions(selected, target) ? target : null;
  const detail = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (hash === "" || !detail.current) return;
    detail.current.scrollIntoView({ block: "start" });
    detail.current.focus({ preventScroll: true });
  }, [selected?.id]);

  return (
    <>
      <PageHeader title="Diagnosis" description={`Each incident names a fault class and the ${lens.sensors} behind it. The chart and the steps show the proof.`}>
        <span id="incident-sort-label" className="text-xs text-muted-foreground">
          Sort by
        </span>
        <ToggleGroup type="single" variant="outline" size="sm" spacing={0} value={sort} onValueChange={(value) => value && setSort(value as Sort)} aria-labelledby="incident-sort-label">
          <ToggleGroupItem value="onset">Onset</ToggleGroupItem>
          <ToggleGroupItem value="family">Family</ToggleGroupItem>
        </ToggleGroup>
        <p className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
          {list.length} incident{list.length === 1 ? "" : "s"}
        </p>
      </PageHeader>
      {incidents.isPending ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      ) : incidents.isError ? (
        <EmptyState icon={StethoscopeIcon} title="Diagnosis not available" description={incidents.error.message} />
      ) : !selected ? (
        <EmptyState
          icon={StethoscopeIcon}
          title="No incidents"
          description={active ? "The run is still in progress. Incidents appear when fault separation finishes." : `The health gate and the drift detector found no fault in this run. Every ${lens.sensor} stays consistent with its peers.`}
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div className="order-2 xl:order-1 xl:sticky xl:top-16 xl:self-start">
            <ScrollArea className="xl:h-[calc(100dvh-9rem)]">
              <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3 xl:pr-3">
                {sorted.map((incident) => (
                  <IncidentCard key={incident.id} incident={incident} selected={incident.id === selected.id} label={label} />
                ))}
              </div>
            </ScrollArea>
          </div>
          <div ref={detail} tabIndex={-1} className="order-1 scroll-mt-16 outline-none xl:order-2">
            <IncidentDetail key={selected.id} incident={selected} runId={runId} highlight={highlight} label={label} />
          </div>
        </div>
      )}
    </>
  );
}
