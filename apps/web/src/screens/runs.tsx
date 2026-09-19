import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { EqualIcon, EqualNotIcon, FilesIcon } from "lucide-react";
import { Domain, Purpose, stageNames, type Run } from "@tpm/schemas";
import { keys, listRuns } from "@/api";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatBytes, formatMs, formatTime, shortHash } from "@/lib/format";

type Filter = "all" | Domain;

export function RunsScreen() {
  const runs = useQuery({ queryKey: keys.runs, queryFn: listRuns });
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<string[]>([]);

  const toggle = (id: string, checked: boolean) =>
    setSelected((ids) => (checked ? [...ids.filter((x) => x !== id), id].slice(-2) : ids.filter((x) => x !== id)));

  const visible = (runs.data ?? []).filter((run) => filter === "all" || run.domain === filter);
  const pair = selected.map((id) => runs.data?.find((run) => run.id === id)).filter((run): run is Run => run !== undefined);

  return (
    <>
      <PageHeader title="Runs" description="Every run of every domain on the same build. Select two runs to compare them.">
        <Tabs value={filter} onValueChange={(value) => setFilter(value as Filter)}>
          <TabsList aria-label="Domain">
            <TabsTrigger value="all">All</TabsTrigger>
            {Domain.options.map((domain) => (
              <TabsTrigger key={domain} value={domain}>
                {domain}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </PageHeader>
      {runs.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : runs.isError ? (
        <EmptyState title="Runs not available" description={runs.error.message} />
      ) : visible.length === 0 ? (
        <EmptyState icon={FilesIcon} title="No runs" description="Start a run from the Run screen." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead scope="col" className="h-8 w-8">
                <span className="sr-only">Compare</span>
              </TableHead>
              <TableHead scope="col" className="h-8">Name</TableHead>
              <TableHead scope="col" className="h-8">Run</TableHead>
              <TableHead scope="col" className="h-8">Domain</TableHead>
              <TableHead scope="col" className="h-8">Status</TableHead>
              <TableHead scope="col" className="h-8">Created</TableHead>
              <TableHead scope="col" className="h-8 text-right">Rows</TableHead>
              <TableHead scope="col" className="h-8 text-right">Sensors</TableHead>
              <TableHead scope="col" className="h-8 text-right">Episodes</TableHead>
              <TableHead scope="col" className="h-8 text-right">Raw</TableHead>
              <TableHead scope="col" className="h-8">Commit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((run) => (
              <TableRow key={run.id} data-state={selected.includes(run.id) ? "selected" : undefined}>
                <TableCell className="py-1">
                  <Checkbox checked={selected.includes(run.id)} onCheckedChange={(checked) => toggle(run.id, checked === true)} aria-label={`Compare ${run.name} ${run.id}`} />
                </TableCell>
                <TableCell className="py-1">
                  <Link to={`/runs/${run.id}/sensors`} className="underline-offset-4 hover:underline">
                    {run.name}
                  </Link>
                  {run.parentRunId && <span className="ml-2 font-mono text-xs text-muted-foreground">rerun of {run.parentRunId}</span>}
                </TableCell>
                <TableCell className="py-1 font-mono text-xs">{run.id}</TableCell>
                <TableCell className="py-1">{run.domain}</TableCell>
                <TableCell className="py-1">{run.status}</TableCell>
                <TableCell className="py-1 font-mono text-xs text-muted-foreground">{formatTime(run.createdAt)}</TableCell>
                <TableCell className="py-1 text-right font-mono tabular-nums">{run.rows.toLocaleString("en-US")}</TableCell>
                <TableCell className="py-1 text-right font-mono tabular-nums">{run.sensorCount}</TableCell>
                <TableCell className="py-1 text-right font-mono tabular-nums">{run.episodes}</TableCell>
                <TableCell className="py-1 text-right font-mono tabular-nums">{formatBytes(run.rawBytes)}</TableCell>
                <TableCell className="py-1 font-mono text-xs">{shortHash(run.commitHash)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {pair.length === 2 && <ComparePanel a={pair[0]!} b={pair[1]!} />}
    </>
  );
}

function Same({ equal }: { equal: boolean }) {
  return equal ? (
    <span className="inline-flex items-center gap-1 text-muted-foreground">
      <EqualIcon className="size-3.5" aria-hidden="true" />
      <span>same</span>
    </span>
  ) : (
    <span className="inline-flex items-center gap-1">
      <EqualNotIcon className="size-3.5" aria-hidden="true" />
      <span>differs</span>
    </span>
  );
}

function ComparePanel({ a, b }: { a: Run; b: Run }) {
  const stageMs = (run: Run, name: string) => formatMs(run.stages.find((s) => s.name === name)?.ms ?? null);
  const rows: { label: string; a: string; b: string; equal?: boolean; mono?: boolean }[] = [
    { label: "Name", a: a.name, b: b.name },
    { label: "Domain", a: a.domain, b: b.domain },
    { label: "Rows", a: a.rows.toLocaleString("en-US"), b: b.rows.toLocaleString("en-US"), mono: true },
    { label: "Sensors", a: String(a.sensorCount), b: String(b.sensorCount), mono: true },
    { label: "Commit", a: shortHash(a.commitHash), b: shortHash(b.commitHash), equal: a.commitHash === b.commitHash, mono: true },
    ...Purpose.options.map((purpose) => ({
      label: `Template ${purpose}`,
      a: shortHash(a.templateHashes[purpose] ?? ""),
      b: shortHash(b.templateHashes[purpose] ?? ""),
      equal: a.templateHashes[purpose] === b.templateHashes[purpose],
      mono: true,
    })),
    ...stageNames.map((name) => ({ label: name, a: stageMs(a, name), b: stageMs(b, name), mono: true })),
  ];
  return (
    <Card className="mt-4 lg:max-w-4xl">
      <CardHeader>
        <CardTitle>Compare</CardTitle>
        <CardDescription>The same build, the same templates, a different domain. Equal hashes prove that nothing was tuned for the second domain.</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead scope="col" className="h-8" />
              <TableHead scope="col" className="h-8 text-right">
                {a.name} <span className="font-mono text-xs text-muted-foreground">{a.id}</span>
              </TableHead>
              <TableHead scope="col" className="h-8 text-right">
                {b.name} <span className="font-mono text-xs text-muted-foreground">{b.id}</span>
              </TableHead>
              <TableHead scope="col" className="h-8 w-24">Match</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.label}>
                <TableCell className="py-1 text-muted-foreground">{row.label}</TableCell>
                <TableCell className={row.mono ? "py-1 text-right font-mono tabular-nums" : "py-1 text-right"}>{row.a}</TableCell>
                <TableCell className={row.mono ? "py-1 text-right font-mono tabular-nums" : "py-1 text-right"}>{row.b}</TableCell>
                <TableCell className="py-1 text-xs">{row.equal !== undefined && <Same equal={row.equal} />}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
