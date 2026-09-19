import { useScrollTarget } from "@/hooks/use-scroll-target";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "react-router";
import { ActivityIcon, SparklesIcon } from "lucide-react";
import { toast } from "sonner";
import { getNameCheckStatus, getSensors, keys, startNameChecks } from "@/api";
import { shortModel } from "@/components/sensors/name-checks";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { SensorSheet } from "@/components/sensors/sensor-sheet";
import { SensorTable } from "@/components/sensors/sensor-table";
import { StructureStrip } from "@/components/sensors/structure-strip";
import { useOpenSensor } from "@/components/sensors/use-open-sensor";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveRunId } from "@/hooks/use-active-run-id";
import { useHeadId } from "@/hooks/use-head-id";
import { useLens } from "@/hooks/use-lens";
import { useRun } from "@/hooks/use-run";
import { capitalize } from "@/lib/format";

export function SensorsScreen() {
  const runId = useActiveRunId() ?? "";
  const run = useRun();
  const lens = useLens();
  const queryClient = useQueryClient();
  const report = useQuery({ queryKey: keys.sensors(runId), queryFn: () => getSensors(runId), enabled: runId !== "" });
  const checkStatus = useQuery({ queryKey: keys.nameCheckStatus(runId), queryFn: () => getNameCheckStatus(runId), enabled: runId !== "", refetchInterval: (q) => (q.state.data?.pending ? 2000 : 15000) });
  const checkAll = useMutation({
    mutationFn: () => startNameChecks(runId),
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: keys.nameCheckStatus(runId) });
      toast.success(`Cross-check started`, { description: `${r.sensors} hypotheses, ${r.models.length} models: ${r.models.map(shortModel).join(", ")}` });
    },
  });
  const pending = checkStatus.data?.pending ?? null;
  const location = useLocation();
  const target = decodeURIComponent(location.hash.slice(1));
  const tab = new URLSearchParams(location.search).get("tab");
  const open = useOpenSensor();
  const sensors = report.data?.sensors ?? [];
  const rowOf = (id: string) => sensors.find((s) => s.alias === id || s.roleInferenceId === id || s.healthInferenceId === id || s.driftInferenceId === id) ?? null;
  const id = useHeadId(target, report.data !== undefined && rowOf(target) === null);
  const selected = target === "" ? null : rowOf(id);
  const alias = selected?.alias ?? null;

  useScrollTarget(alias);

  const failed = sensors.filter((s) => s.health !== "healthy").length;
  const title = capitalize(lens.sensors);
  return (
    <>
      <PageHeader
        title={title}
        description={
          report.data
            ? `${sensors.length} ${lens.sensors}, ${failed} with a failed health check. Roles come from statistics only. The agent never saw a column name.`
            : `Role, evidence and confidence for each ${lens.sensor}.`
        }
      >
        {checkStatus.data && checkStatus.data.models.length > 0 && (
          <span className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground" aria-live="polite">
              {pending ? `Cross-check ${pending.done} of ${pending.total}, now ${shortModel(pending.model)}` : `Reviewers: ${checkStatus.data.models.map(shortModel).join(", ")}`}
            </span>
            <Button size="sm" variant="outline" onClick={() => checkAll.mutate()} disabled={checkAll.isPending || pending !== null}>
              <SparklesIcon aria-hidden="true" /> Cross-check names
            </Button>
          </span>
        )}
      </PageHeader>
      {report.isPending ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : report.isError ? (
        <EmptyState title={`${title} not available`} description={report.error.message} />
      ) : sensors.length === 0 ? (
        <EmptyState icon={ActivityIcon} title={`No ${lens.sensors}`} description={run.data?.status === "done" ? `The run found no numeric column.` : "The run is not finished yet."} />
      ) : (
        <>
          <StructureStrip report={report.data} current={alias} lens={lens} />
          <SensorTable sensors={sensors} current={alias} lens={lens} />
          <SensorSheet
            run={run.data}
            report={report.data}
            row={selected}
            initialTab={id === selected?.roleInferenceId ? "roles" : tab === "knowledge" ? "knowledge" : "fingerprint"}
            lens={lens}
            onClose={() => open(null)}
          />
        </>
      )}
    </>
  );
}
