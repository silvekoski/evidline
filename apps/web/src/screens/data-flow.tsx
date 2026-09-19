import { useCallback, useEffect, type ReactNode } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router";
import { ShieldCheckIcon } from "lucide-react";
import { cn } from "cn";
import type { EgressRecord } from "@tpm/schemas";
import { getEgress, getEgressTemplates, getEgressTotals, getModelSettings, keys } from "@/api";
import { BoundaryDiagram } from "@/components/data-flow/boundary-diagram";
import { ModelModeCard } from "@/components/data-flow/model-mode-card";
import { RecordDialog } from "@/components/data-flow/record-dialog";
import { RecordTable } from "@/components/data-flow/record-table";
import { TemplatePanel } from "@/components/data-flow/template-panel";
import { TotalsCards } from "@/components/data-flow/totals-cards";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveRunId } from "@/hooks/use-active-run-id";
import { useLens } from "@/hooks/use-lens";
import { useRun } from "@/hooks/use-run";

function payloadAlias(record: EgressRecord): string | null {
  try {
    const payload = JSON.parse(record.payload) as { sensor?: { alias?: unknown } };
    return typeof payload.sensor?.alias === "string" ? payload.sensor.alias : null;
  } catch {
    return null;
  }
}

function findRecord(records: EgressRecord[], target: string): EgressRecord | null {
  if (target === "") return null;
  const newestFirst = [...records].sort((a, b) => b.time.localeCompare(a.time));
  return (
    newestFirst.find((r) => r.id === target || r.inferenceId === target) ??
    newestFirst.find((r) => r.purpose === "name_role" && payloadAlias(r) === target) ??
    null
  );
}

function Block<T>({ query, title, height, children }: { query: UseQueryResult<T>; title: string; height: string; children: (data: T) => ReactNode }) {
  if (query.data !== undefined) return <>{children(query.data)}</>;
  if (query.isError) return <EmptyState title={title} description={query.error.message} />;
  return <Skeleton className={cn("w-full", height)} />;
}

export function DataFlowScreen() {
  const runId = useActiveRunId() ?? undefined;
  const run = useRun();
  const lens = useLens();
  const navigate = useNavigate();
  const target = decodeURIComponent(useLocation().hash.slice(1));
  const settings = useQuery({ queryKey: keys.modelSettings, queryFn: getModelSettings });
  const live = settings.data !== undefined && settings.data.mode !== "off";
  const totals = useQuery({ queryKey: keys.egressTotals(runId), queryFn: () => getEgressTotals(runId), refetchInterval: live ? 5000 : false });
  const records = useQuery({ queryKey: keys.egress(runId), queryFn: () => getEgress(runId), refetchInterval: live ? 5000 : false });
  const templates = useQuery({ queryKey: keys.egressTemplates, queryFn: getEgressTemplates, staleTime: Infinity });
  const open = useCallback((id: string | null) => navigate({ hash: id ? `#${id}` : "" }, { replace: true }), [navigate]);
  const selected = findRecord(records.data ?? [], target);
  const selectedId = selected?.id ?? null;
  const runHashes = run.data?.templateHashes;

  useEffect(() => {
    if (selectedId) document.getElementById(selectedId)?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  return (
    <>
      <PageHeader
        title="Data flow"
        description={`One egress gateway is the only code that can reach a model. It scans each payload against the raw data and writes a record before it sends, in every mode. Raw data never leaves the ${lens.plant}.`}
      >
        {records.data && (
          <span className="text-sm text-muted-foreground tabular-nums">
            {records.data.length} {records.data.length === 1 ? "record" : "records"}
          </span>
        )}
      </PageHeader>
      <div className="flex flex-col gap-4">
        <Block query={totals} title="Totals not available" height="h-24">
          {(data) => <TotalsCards totals={data} plant={lens.plant} />}
        </Block>
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <Card size="sm">
            <CardHeader>
              <CardTitle>Boundary</CardTitle>
              <CardDescription>Solid lines carry raw data and stay inside the {lens.plant}. The dotted line carries summaries only. The gateway is the single exit.</CardDescription>
            </CardHeader>
            <CardContent>
              <Block query={totals} title="Totals not available" height="h-56">
                {(data) => (
                  <Block query={settings} title="Model settings not available" height="h-56">
                    {(current) => <BoundaryDiagram totals={data} settings={current} plant={lens.plant} />}
                  </Block>
                )}
              </Block>
            </CardContent>
          </Card>
          <Block query={settings} title="Model settings not available" height="h-40">
            {(current) => <ModelModeCard settings={current} plant={lens.plant} />}
          </Block>
        </div>
        <Block query={templates} title="Templates not available" height="h-40">
          {(data) => <TemplatePanel templates={data} runHashes={runHashes} />}
        </Block>
        <section aria-labelledby="records-title" className="flex flex-col gap-2">
          <h2 id="records-title" className="font-heading text-base font-medium">
            Records
          </h2>
          <p className="text-sm text-muted-foreground">
            One record per model call: what left, which model, why, the proof from seven guards, and what came back. Open a row to read the payload verbatim.
          </p>
          {records.data === undefined && records.isError ? (
            <EmptyState icon={ShieldCheckIcon} title="Records not available" description={records.error.message} />
          ) : records.data === undefined ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <RecordTable records={records.data} current={selectedId} onOpen={open} />
          )}
        </section>
      </div>
      <RecordDialog record={selected} runHashes={runHashes} onClose={() => open(null)} />
    </>
  );
}
