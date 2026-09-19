import { useQuery } from "@tanstack/react-query";
import { useLocation } from "react-router";
import { DownloadIcon, ScrollTextIcon, ShieldCheckIcon } from "lucide-react";
import { getLog, keys, logExportUrl, verifyLog } from "@/api";
import { EmptyState } from "@/components/empty-state";
import { LogTable } from "@/components/log/log-table";
import { useInferenceScreens } from "@/components/log/use-inference-screens";
import { VerifyAlert } from "@/components/log/verify-alert";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveRunId } from "@/hooks/use-active-run-id";
import { useLens } from "@/hooks/use-lens";
import { useRun } from "@/hooks/use-run";

export function LogScreen() {
  const runId = useActiveRunId() ?? "";
  const run = useRun();
  const lens = useLens();
  const log = useQuery({ queryKey: keys.log(runId), queryFn: () => getLog(runId), enabled: runId !== "" });
  const verification = useQuery({ queryKey: keys.logVerify, queryFn: verifyLog, enabled: false });
  const screens = useInferenceScreens(runId);
  const target = decodeURIComponent(useLocation().hash.slice(1));
  const entries = log.data ?? [];
  const byOperator = entries.filter((entry) => entry.actor === "operator").length;

  return (
    <>
      <PageHeader
        title="Log"
        description={
          log.data
            ? `${entries.length} entries in this run, ${byOperator} by the ${lens.operator}. Each entry stores the hash of the previous entry plus its own content.`
            : "Append-only decision log with a hash chain."
        }
      >
        <Button variant="outline" onClick={() => void verification.refetch()} disabled={verification.isFetching}>
          <ShieldCheckIcon aria-hidden="true" />
          Verify chain
        </Button>
        <Button asChild variant="outline">
          <a href={logExportUrl("json")} download="decision-log.json">
            <DownloadIcon aria-hidden="true" />
            Export JSON
          </a>
        </Button>
        <Button asChild variant="outline">
          <a href={logExportUrl("csv")} download="decision-log.csv">
            <DownloadIcon aria-hidden="true" />
            Export CSV
          </a>
        </Button>
      </PageHeader>
      <div className="flex flex-col gap-4">
        <VerifyAlert verification={verification} />
        {log.isPending ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : log.isError ? (
          <EmptyState title="Log not available" description={log.error.message} />
        ) : entries.length === 0 ? (
          <EmptyState icon={ScrollTextIcon} title="No entries" description={run.data?.status === "done" ? "The run wrote no log entry." : "The run is not finished yet."} />
        ) : (
          <LogTable entries={entries} runId={runId} target={target} screens={screens} lens={lens} />
        )}
      </div>
    </>
  );
}
