import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "react-router";
import { TrendingUpIcon } from "lucide-react";
import { getDrift, keys } from "@/api";
import { useActiveRunId } from "@/hooks/use-active-run-id";
import { useLens } from "@/hooks/use-lens";
import { useRun } from "@/hooks/use-run";
import { useTimeBase } from "@/hooks/use-time-base";
import { DriftCard } from "@/components/drift/drift-card";
import { isDrifting } from "@/components/drift/drift-data";
import { DriftDetail } from "@/components/drift/drift-detail";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

type Filter = "all" | "drifting";

export function DriftScreen() {
  const runId = useActiveRunId() ?? "";
  const lens = useLens();
  const run = useRun();
  const label = useTimeBase(run.data);
  const { hash } = useLocation();
  const [filter, setFilter] = useState<Filter>("all");
  const report = useQuery({ queryKey: keys.drift(runId), queryFn: () => getDrift(runId), enabled: runId !== "" });

  const sorted = [...(report.data?.drifts ?? [])].sort((a, b) => b.value.severity - a.value.severity || a.value.sensor.localeCompare(b.value.sensor));
  const drifting = sorted.filter((d) => isDrifting(d.value));
  const target = hash.slice(1);
  const selected = sorted.find((d) => d.id === target || d.value.sensor === target) ?? sorted[0];
  const visible = filter === "drifting" ? drifting : sorted;
  const aliases = new Set(sorted.map((d) => d.value.sensor));

  return (
    <>
      <PageHeader
        title="Drift"
        description={`The agent measures each ${lens.sensor} against what its peers predict, not against fixed limits. A ${lens.sensor} can drift inside its normal range.`}
      >
        {report.data && (
          <span className="text-sm text-muted-foreground tabular-nums">
            {drifting.length} of {sorted.length} {lens.sensors} drift
          </span>
        )}
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          spacing={0}
          value={filter}
          onValueChange={(value) => {
            if (value) setFilter(value as Filter);
          }}
          aria-label="Show"
        >
          <ToggleGroupItem value="all">All {lens.sensors}</ToggleGroupItem>
          <ToggleGroupItem value="drifting">Drifting only</ToggleGroupItem>
        </ToggleGroup>
      </PageHeader>
      {report.isPending ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      ) : report.isError ? (
        <EmptyState title="Drift output not available" description={report.error.message} />
      ) : sorted.length === 0 ? (
        <EmptyState icon={TrendingUpIcon} title="No drift output" description="The drift detector wrote no inference for this run." />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <ScrollArea className="order-2 xl:order-1 xl:sticky xl:top-16 xl:h-[calc(100dvh-9rem)] xl:self-start">
            {visible.length === 0 ? (
              <EmptyState icon={TrendingUpIcon} title="No drift found" description={`Every ${lens.sensor} stays within what its peers predict.`} />
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-3 xl:pr-3">
                {visible.map((d) => (
                  <DriftCard key={d.id} inference={d} selected={d.id === selected?.id} label={label} />
                ))}
              </div>
            )}
          </ScrollArea>
          <div className="order-1 xl:order-2">
            {selected && <DriftDetail inference={selected} runId={runId} aliases={aliases} label={label} dt={run.data?.timeBase.dt ?? null} />}
          </div>
        </div>
      )}
    </>
  );
}
