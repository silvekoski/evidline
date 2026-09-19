import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "react-router";
import type { ExpandedState } from "@tanstack/react-table";
import { ListChecksIcon } from "lucide-react";
import type { QualityReport, Run } from "@tpm/schemas";
import { getLanes, getQuality, keys } from "@/api";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { GateSetup } from "@/components/quality/gate-setup";
import { HealthGroups } from "@/components/quality/health-groups";
import { QualitySummary } from "@/components/quality/quality-summary";
import { RuleComposer } from "@/components/quality/rule-composer";
import { RuleTable } from "@/components/quality/rule-table";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useActiveRunId } from "@/hooks/use-active-run-id";
import { useLens } from "@/hooks/use-lens";
import { useRun } from "@/hooks/use-run";
import { useTimeBase } from "@/hooks/use-time-base";

type Tab = "checks" | "rules";

function resolveTarget(report: QualityReport, hash: string): { tab: Tab; id: string } | null {
  if (!hash) return null;
  if (hash === report.baseline.id || report.calibration.some((c) => c.id === hash)) return { tab: "checks", id: hash };
  const check = report.checks.find((c) => c.id === hash || c.value.sensor === hash);
  if (check) return { tab: "checks", id: check.id };
  const rule = report.rules.find((r) => r.inferenceId === hash || r.id === hash);
  return rule ? { tab: "rules", id: rule.inferenceId } : null;
}

export function QualityScreen() {
  const runId = useActiveRunId();
  const lens = useLens();
  const run = useRun();
  const quality = useQuery({ queryKey: keys.quality(runId ?? ""), queryFn: () => getQuality(runId ?? ""), enabled: runId !== null });

  return (
    <>
      <PageHeader title="Quality" description={`The health gate runs first and masks each window that fails a check. Rules add checks that the ${lens.operator} writes as sentences.`} />
      {runId === null ? (
        <EmptyState icon={ListChecksIcon} title="No run selected" description="Select a run in the sidebar." />
      ) : quality.isPending || run.isPending ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : quality.isError ? (
        <EmptyState title="Quality report not available" description={quality.error.message} />
      ) : run.isError ? (
        <EmptyState title="Run not available" description={run.error.message} />
      ) : (
        <QualityBody run={run.data} report={quality.data} />
      )}
    </>
  );
}

function QualityBody({ run, report }: { run: Run; report: QualityReport }) {
  const label = useTimeBase(run);
  const day = run.timeBase.dt ? label : null;
  const lanes = useQuery({ queryKey: keys.lanes(run.id), queryFn: () => getLanes(run.id), staleTime: Infinity });
  const hash = useLocation().hash.slice(1);
  const [tab, setTab] = useState<Tab>("checks");
  const [checksExpanded, setChecksExpanded] = useState<Record<string, boolean>>({});
  const [rulesExpanded, setRulesExpanded] = useState<ExpandedState>({});
  const target = resolveTarget(report, hash);
  const targetId = target?.id ?? null;
  const targetTab = target?.tab ?? null;
  const scrolled = useRef<string | null>(null);

  useEffect(() => {
    if (!targetId || !targetTab) return;
    setTab(targetTab);
    if (targetTab === "checks") setChecksExpanded((old) => ({ ...old, [targetId]: true }));
    else setRulesExpanded((old) => ({ ...(old === true ? {} : old), [targetId]: true }));
  }, [targetId, targetTab]);

  useEffect(() => {
    if (!targetId || scrolled.current === targetId) return;
    const element = document.getElementById(targetId);
    if (!element) return;
    scrolled.current = targetId;
    element.focus({ preventScroll: true });
    element.scrollIntoView({ block: "center" });
  }, [targetId, tab, checksExpanded, rulesExpanded]);

  const activeRules = report.rules.filter((r) => r.active).length;

  return (
    <div className="flex flex-col gap-4">
      <QualitySummary report={report} gridSize={run.gridSize} />
      <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)}>
        <TabsList aria-label="Quality views">
          <TabsTrigger value="checks">Health gate</TabsTrigger>
          <TabsTrigger value="rules">Rules</TabsTrigger>
        </TabsList>
        <TabsContent value="checks" className="flex flex-col gap-4">
          <GateSetup baseline={report.baseline} calibration={report.calibration} day={day} targetId={targetId} />
          <HealthGroups checks={report.checks} lanes={lanes.data} baseline={report.baseline} run={run} label={label} day={day} expanded={checksExpanded} onExpandedChange={setChecksExpanded} targetId={targetId} />
        </TabsContent>
        <TabsContent value="rules" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              {report.rules.length} {report.rules.length === 1 ? "rule" : "rules"}, {activeRules} active. The agent proposed the baseline rules from the fingerprint and counts violations on the whole run.
            </p>
            <RuleComposer runId={run.id} gridSize={run.gridSize} />
          </div>
          <RuleTable rules={report.rules} gridSize={run.gridSize} expanded={rulesExpanded} onExpandedChange={setRulesExpanded} targetId={targetId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
