import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "react-router";
import { ActivityIcon } from "lucide-react";
import { getSensors, keys } from "@/api";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { SensorSheet } from "@/components/sensors/sensor-sheet";
import { SensorTable } from "@/components/sensors/sensor-table";
import { StructureStrip } from "@/components/sensors/structure-strip";
import { useOpenSensor } from "@/components/sensors/use-open-sensor";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveRunId } from "@/hooks/use-active-run-id";
import { useLens } from "@/hooks/use-lens";
import { useRun } from "@/hooks/use-run";
import { capitalize } from "@/lib/format";

export function SensorsScreen() {
  const runId = useActiveRunId() ?? "";
  const run = useRun();
  const lens = useLens();
  const report = useQuery({ queryKey: keys.sensors(runId), queryFn: () => getSensors(runId), enabled: runId !== "" });
  const target = decodeURIComponent(useLocation().hash.slice(1));
  const open = useOpenSensor();
  const sensors = report.data?.sensors ?? [];
  const selected =
    target === ""
      ? null
      : (sensors.find((s) => s.alias === target || s.roleInferenceId === target || s.healthInferenceId === target || s.driftInferenceId === target) ?? null);
  const alias = selected?.alias ?? null;

  useEffect(() => {
    if (alias) document.getElementById(alias)?.scrollIntoView({ block: "nearest" });
  }, [alias]);

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
      />
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
            initialTab={target === selected?.roleInferenceId ? "roles" : "fingerprint"}
            lens={lens}
            onClose={() => open(null)}
          />
        </>
      )}
    </>
  );
}
