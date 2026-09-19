import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "react-router";
import type { ExpandedState } from "@tanstack/react-table";
import { ListChecksIcon } from "lucide-react";
import type { QualityReport } from "@tpm/schemas";
import { getQuality, keys } from "@/api";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { BaselineCard } from "@/components/quality/baseline-card";
import { CalibrationCard } from "@/components/quality/calibration-card";
import { HealthTable } from "@/components/quality/health-table";
import { RuleComposer } from "@/components/quality/rule-composer";
import { RuleTable } from "@/components/quality/rule-table";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useActiveRunId } from "@/hooks/use-active-run-id";
import { useLens } from "@/hooks/use-lens";
import { useRun } from "@/hooks/use-run";
import { useTimeBase } from "@/hooks/use-time-base";

type Tab = "checks" | "rules";

const calibrationTitles = ["Health calibration", "Drift calibration"];

function resolveTarget(report: QualityReport, hash: string): { tab: Tab; id: string } | null {
  if (!hash) return null;
  if (hash === report.baseline.id || report.calibration.some((c) => c.id === hash)) return { tab: "checks", id: hash };
  const check = report.checks.find((c) => c.id === hash || c.value.sensor === hash);
  if (check) return { tab: "checks", id: check.id };
  const rule = report.rules.find((r) => r.inferenceId === hash || r.id === hash);
  return rule ? { tab: "rules", id: rule.inferenceId } : null;
}

const expand = (id: string) => (old: ExpandedState) => ({ ...(old === true ? {} : old), [id]: true });

export function QualityScreen() {
  const runId = useActiveRunId();
  const lens = useLens();
  const quality = useQuery({ queryKey: keys.quality(runId ?? ""), queryFn: () => getQuality(runId ?? ""), enabled: runId !== null });

  return (
    <>
      <PageHeader title="Quality" description={`The health gate runs first. It masks each window that fails a check, and no later stage uses a masked window. Rules add checks that the ${lens.operator} writes as sentences.`} />
      {runId === null ? (
        <EmptyState icon={ListChecksIcon} title="No run selected" description="Select a run in the sidebar." />
      ) : quality.isPending ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : quality.isError ? (
        <EmptyState title="Quality report not available" description={quality.error.message} />
      ) : (
        <QualityTabs runId={runId} report={quality.data} />
      )}
    </>
  );
}

function QualityTabs({ runId, report }: { runId: string; report: QualityReport }) {
  const run = useRun();
  const lens = useLens();
  const label = useTimeBase(run.data);
  const day = run.data?.timeBase.dt ? label : null;
  const hash = useLocation().hash.slice(1);
  const [tab, setTab] = useState<Tab>("checks");
  const [checksExpanded, setChecksExpanded] = useState<ExpandedState>({});
  const [rulesExpanded, setRulesExpanded] = useState<ExpandedState>({});
  const target = resolveTarget(report, hash);
  const targetId = target?.id ?? null;
  const targetTab = target?.tab ?? null;
  const scrolled = useRef<string | null>(null);

  useEffect(() => {
    if (!targetId || !targetTab) return;
    setTab(targetTab);
    (targetTab === "checks" ? setChecksExpanded : setRulesExpanded)(expand(targetId));
  }, [targetId, targetTab]);

  useEffect(() => {
    if (!targetId || scrolled.current === targetId) return;
    const element = document.getElementById(targetId);
    if (!element) return;
    scrolled.current = targetId;
    element.focus({ preventScroll: true });
    element.scrollIntoView({ block: "center" });
  }, [targetId, tab, checksExpanded, rulesExpanded]);

  const failed = report.checks.filter((c) => c.value.health !== "healthy").length;
  const maskedWindows = report.checks.reduce((sum, c) => sum + c.value.masked.length, 0);
  const activeRules = report.rules.filter((r) => r.active).length;
  const calibrations = [...report.calibration].sort((a, b) => a.seq - b.seq);

  return (
    <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)}>
      <TabsList aria-label="Quality views">
        <TabsTrigger value="checks">Checks</TabsTrigger>
        <TabsTrigger value="rules">Rules</TabsTrigger>
      </TabsList>
      <TabsContent value="checks" className="flex flex-col gap-4">
        <div className="grid items-start gap-4 xl:grid-cols-3">
          <BaselineCard inference={report.baseline} day={day} targeted={targetId === report.baseline.id} />
          {calibrations.map((inference, i) => (
            <CalibrationCard key={inference.id} inference={inference} title={calibrationTitles[i] ?? "Calibration"} day={day} targeted={targetId === inference.id} />
          ))}
        </div>
        <section aria-labelledby="health-checks-title" className="flex flex-col gap-2">
          <h2 id="health-checks-title" className="font-heading text-base font-medium">
            Health checks
          </h2>
          <p className="text-muted-foreground">
            {report.checks.length} {lens.sensors}, {failed} with a failed check, {maskedWindows} masked {maskedWindows === 1 ? "window" : "windows"}. Open a row to see every check with its statistic and threshold.
          </p>
          <HealthTable checks={report.checks} day={day} expanded={checksExpanded} onExpandedChange={setChecksExpanded} targetId={targetId} />
        </section>
      </TabsContent>
      <TabsContent value="rules">
        <div className="grid items-start gap-4 xl:grid-cols-3">
          <section aria-labelledby="rules-title" className="flex flex-col gap-2 xl:col-span-2">
            <h2 id="rules-title" className="font-heading text-base font-medium">
              Rules
            </h2>
            <p className="text-muted-foreground">
              {report.rules.length} {report.rules.length === 1 ? "rule" : "rules"}, {activeRules} active. The agent proposed the baseline rules from the fingerprint and counts violations on the whole run.
            </p>
            <RuleTable rules={report.rules} expanded={rulesExpanded} onExpandedChange={setRulesExpanded} targetId={targetId} />
          </section>
          <RuleComposer runId={runId} />
        </div>
      </TabsContent>
    </Tabs>
  );
}
