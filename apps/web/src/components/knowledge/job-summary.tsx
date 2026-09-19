import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleXIcon, LoaderIcon, RefreshCwIcon } from "lucide-react";
import { cn } from "cn";
import type { JobSummary as Summary } from "@tpm/schemas";
import { getJobSummary, keys, retryJobs } from "@/api";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatTime } from "@/lib/format";

const jobWords: Record<Summary["types"][number]["type"], string> = {
  normalize: "Read files",
  chunk: "Chunk text",
  embed: "Embed chunks",
  extract: "Extract claims",
  link: "Link claims to columns",
  "run-sensor-file": "Run sensor files",
  "connector-sync": "Sync connectors",
  "renew-subscriptions": "Renew webhooks",
  retention: "Apply retention",
  reembed: "Embed again",
};

const jobLabel = (type: string): string => jobWords[type as keyof typeof jobWords] ?? type;
const describe = (payload: Record<string, unknown>): string => {
  const ids = payload.chunkIds;
  if (Array.isArray(ids)) return `${ids.length} chunks`;
  if (typeof payload.sourceId === "number") return `source ${payload.sourceId}`;
  if (typeof payload.chunkId === "number") return `chunk ${payload.chunkId}`;
  if (typeof payload.claimId === "number") return `claim ${payload.claimId}`;
  if (typeof payload.connectorId === "number") return `connector ${payload.connectorId}`;
  return "";
};

function Share({ row }: { row: Summary["types"][number] }) {
  const total = row.queued + row.running + row.done + row.failed;
  const pct = (n: number) => `${total ? (n / total) * 100 : 0}%`;
  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-sm bg-muted" role="presentation">
      <div className="bg-foreground" style={{ width: pct(row.done) }} />
      <div className="bg-muted-foreground" style={{ width: pct(row.running) }} />
      <div className="bg-border" style={{ width: pct(row.queued) }} />
    </div>
  );
}

export function JobSummary() {
  const queryClient = useQueryClient();
  const summary = useQuery({ queryKey: keys.jobSummary, queryFn: getJobSummary, refetchInterval: 5000 });
  const retry = useMutation({ mutationFn: retryJobs, onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.jobs }) });
  const order = Object.keys(jobWords);
  const types = [...(summary.data?.types ?? [])].sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
  const failed = summary.data?.failed ?? [];
  const queued = types.reduce((n, t) => n + t.queued + t.running, 0);
  const running = types.some((t) => t.running > 0);

  return (
    <section className="mt-6" aria-labelledby="jobs-title">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 id="jobs-title" className="flex items-center gap-2 text-sm font-medium">
          {running && <LoaderIcon aria-hidden="true" className="size-3.5 motion-safe:animate-spin" />}
          Pipeline jobs <span className="text-muted-foreground">({queued} queued, {failed.length} failed)</span>
        </h2>
        {failed.length > 0 && (
          <Button size="xs" variant="outline" onClick={() => retry.mutate()} disabled={retry.isPending}>
            <RefreshCwIcon aria-hidden="true" /> Retry failed
          </Button>
        )}
      </div>
      {types.length === 0 ? (
        <p className="text-sm text-muted-foreground">No job yet. Jobs appear when a source arrives.</p>
      ) : (
        <Table aria-label="Jobs by type">
          <TableHeader>
            <TableRow>
              <TableHead scope="col" className="h-8">Step</TableHead>
              <TableHead scope="col" className="h-8 w-48">Progress</TableHead>
              <TableHead scope="col" className="h-8 text-right">Done</TableHead>
              <TableHead scope="col" className="h-8 text-right">Queued</TableHead>
              <TableHead scope="col" className="h-8 text-right">Failed</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {types.map((row) => (
              <TableRow key={row.type}>
                <TableCell className="py-1">
                  {jobLabel(row.type)} <span className="font-mono text-xs text-muted-foreground">{row.type}</span>
                </TableCell>
                <TableCell className="py-1">
                  <Share row={row} />
                </TableCell>
                <TableCell className="py-1 text-right font-mono tabular-nums">{row.done}</TableCell>
                <TableCell className={cn("py-1 text-right font-mono tabular-nums", row.queued + row.running === 0 && "text-muted-foreground")}>{row.queued + row.running}</TableCell>
                <TableCell className={cn("py-1 text-right font-mono tabular-nums", row.failed === 0 && "text-muted-foreground")}>{row.failed}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {failed.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1" aria-label="Failed jobs">
          {failed.map((job) => (
            <li key={job.id} className="grid gap-x-3 rounded-md border p-2 text-xs sm:grid-cols-[auto_1fr_auto]">
              <span className="flex items-center gap-1 font-medium">
                <CircleXIcon aria-hidden="true" className="size-3.5" /> {jobLabel(job.type)} <span className="font-mono text-muted-foreground">{describe(job.payload)}</span>
              </span>
              <span className="text-muted-foreground">{job.lastError}</span>
              <span className="font-mono text-muted-foreground">
                {job.attempts} tries, last {formatTime(job.runAfter)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
