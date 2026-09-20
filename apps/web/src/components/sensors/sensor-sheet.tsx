import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { ActivityIcon, TrendingUpIcon } from "lucide-react";
import type { Lens, Run, SensorReport, SensorRow } from "@tpm/schemas";
import { getSensor, keys } from "@/api";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTimeBase } from "@/hooks/use-time-base";
import { screenPath } from "@/layout/screens";
import { FingerprintTab } from "./fingerprint-tab";
import { HealthBadge } from "./health-badge";
import { KnowledgeTab } from "./knowledge-tab";
import { Hypothesis } from "./hypothesis";
import { RelationsTab } from "./relations-tab";
import { RolesTab } from "./roles-tab";

export type SheetTab = "fingerprint" | "roles" | "relations" | "knowledge" | "notes";

export function SensorSheet({
  run,
  report,
  row,
  initialTab,
  lens,
  onClose,
}: {
  run: Run | undefined;
  report: SensorReport;
  row: SensorRow | null;
  initialTab: SheetTab;
  lens: Lens;
  onClose: () => void;
}) {
  return (
    <Sheet open={row !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="overflow-y-auto data-[side=right]:sm:max-w-3xl">
        {row && <SensorBody key={row.alias} run={run} report={report} row={row} initialTab={initialTab} lens={lens} />}
      </SheetContent>
    </Sheet>
  );
}

function SensorBody({ run, report, row, initialTab, lens }: { run: Run | undefined; report: SensorReport; row: SensorRow; initialTab: SheetTab; lens: Lens }) {
  const detail = useQuery({ queryKey: keys.sensor(report.runId, row.alias), queryFn: () => getSensor(report.runId, row.alias) });
  const label = useTimeBase(run);
  const dt = run?.timeBase.dt ?? null;
  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex flex-wrap items-center gap-2">
          <span className="font-mono">{row.alias}</span>
          <span className="font-normal">{row.role}</span>
          <Hypothesis name={row.hypothesisName} />
        </SheetTitle>
        <SheetDescription>
          Source column <span className="font-mono">{row.sourceName}</span>, never sent. {row.signalType} signal.
        </SheetDescription>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <HealthBadge health={row.health} />
          <StatusBadge kind={row.status} />
          <Button asChild variant="outline" size="xs">
            <Link to={screenPath(report.runId, "quality", row.healthInferenceId)}>
              <ActivityIcon aria-hidden="true" />
              Health check
            </Link>
          </Button>
          {row.driftInferenceId && (
            <Button asChild variant="outline" size="xs">
              <Link to={screenPath(report.runId, "drift", row.driftInferenceId)}>
                <TrendingUpIcon aria-hidden="true" />
                Drift
              </Link>
            </Button>
          )}
        </div>
      </SheetHeader>
      <Tabs defaultValue={initialTab} className="px-4 pb-4">
        <TabsList aria-label={`${row.alias} details`}>
          <TabsTrigger value="roles">Roles</TabsTrigger>
          <TabsTrigger value="fingerprint">Fingerprint</TabsTrigger>
          <TabsTrigger value="relations">Relations</TabsTrigger>
          <TabsTrigger value="knowledge">Knowledge</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
        </TabsList>
        {detail.data ? (
          <>
            <TabsContent value="roles">
              <RolesTab detail={detail.data} />
            </TabsContent>
            <TabsContent value="fingerprint">
              <FingerprintTab alias={row.alias} fingerprint={detail.data.fingerprint} label={label} dt={dt} />
            </TabsContent>
            <TabsContent value="relations">
              <RelationsTab detail={detail.data} report={report} lens={lens} dt={dt} />
            </TabsContent>
            <TabsContent value="knowledge">
              <KnowledgeTab sourceName={row.sourceName} />
            </TabsContent>
            <TabsContent value="notes">
              {detail.data.notes.length === 0 ? (
                <p className="text-muted-foreground">No notes yet. Questions and override reasons stay attached to this {lens.sensor} for the next run.</p>
              ) : (
                <ol className="flex flex-col gap-2">
                  {detail.data.notes.map((note, i) => (
                    <li key={i} className="border-l pl-3">
                      {note}
                    </li>
                  ))}
                </ol>
              )}
            </TabsContent>
          </>
        ) : detail.isError ? (
          <p className="text-muted-foreground">{detail.error.message}</p>
        ) : (
          <Skeleton className="h-64 w-full" />
        )}
      </Tabs>
    </>
  );
}
