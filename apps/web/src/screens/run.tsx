import { useEffect, useRef, useState, type DragEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { CheckIcon, CircleIcon, FileUpIcon, LoaderCircleIcon, MinusIcon, PlayIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { stageNames, type FileEntry, type Run, type StageProgress } from "@tpm/schemas";
import { createRun, keys, listFiles, subscribeRunEvents, uploadFile } from "@/api";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatBytes, formatMs, formatTime } from "@/lib/format";

const pendingStages = (): StageProgress[] => stageNames.map((name, stage) => ({ stage, name, status: "pending", ms: null, counts: {} }));

const statusIcon = {
  pending: CircleIcon,
  running: LoaderCircleIcon,
  done: CheckIcon,
  failed: XIcon,
  skipped: MinusIcon,
} as const;

export function RunScreen() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const files = useQuery({ queryKey: keys.files, queryFn: listFiles });
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [stages, setStages] = useState<StageProgress[]>(pendingStages);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const start = useMutation({
    mutationFn: async (source: File | FileEntry) => {
      const entry = source instanceof File ? await uploadFile(source) : source;
      void queryClient.invalidateQueries({ queryKey: keys.files });
      return createRun(entry.path);
    },
    onSuccess: ({ runId: id }) => {
      setRunId(id);
      setRun(null);
      setStages(pendingStages());
      void queryClient.invalidateQueries({ queryKey: keys.runs });
    },
  });

  useEffect(() => {
    if (!runId) return;
    return subscribeRunEvents(runId, (event) => {
      switch (event.type) {
        case "stage":
          setStages((list) => list.map((s) => (s.name === event.stage.name ? event.stage : s)));
          break;
        case "run":
          setRun(event.run);
          if (event.run.stages.length) setStages(event.run.stages);
          break;
        case "done":
          void queryClient.invalidateQueries({ queryKey: keys.runs });
          toast.success("Run done", {
            description: `Run ${event.runId} finished.`,
            action: { label: "Open sensors", onClick: () => navigate(`/runs/${event.runId}/sensors`) },
          });
          break;
        case "error":
          toast.error("Run failed", { description: event.message });
          break;
      }
    });
  }, [runId, queryClient, navigate]);

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) start.mutate(file);
  };

  const doneCount = stages.filter((s) => s.status === "done" || s.status === "skipped").length;

  return (
    <>
      <PageHeader title="Run" description="Drop a file. The agent configures nothing and infers everything from the data." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Files</CardTitle>
            <CardDescription>Files in the data directory of the plant. A dropped file stays in the plant.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div
              role="group"
              aria-label="File drop zone"
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={cn("flex flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-center", dragging && "border-foreground bg-muted")}
            >
              <FileUpIcon className="size-5 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm text-muted-foreground">Drop a CSV file here, or</p>
              <input
                ref={input}
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                tabIndex={-1}
                aria-label="Choose a file"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) start.mutate(file);
                  event.target.value = "";
                }}
              />
              <Button variant="outline" size="sm" onClick={() => input.current?.click()} disabled={start.isPending}>
                Choose a file
              </Button>
            </div>
            {files.isPending ? (
              <div className="flex flex-col gap-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : files.isError ? (
              <EmptyState title="Files not available" description={files.error.message} />
            ) : files.data.length === 0 ? (
              <EmptyState title="No files" description="Drop a file to start." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col" className="h-8">Name</TableHead>
                    <TableHead scope="col" className="h-8 text-right">Size</TableHead>
                    <TableHead scope="col" className="h-8">Modified</TableHead>
                    <TableHead scope="col" className="h-8 sr-only">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {files.data.map((file) => (
                    <TableRow key={file.path}>
                      <TableCell className="py-1 font-mono text-xs">{file.name}</TableCell>
                      <TableCell className="py-1 text-right font-mono tabular-nums">{formatBytes(file.bytes)}</TableCell>
                      <TableCell className="py-1 font-mono text-xs text-muted-foreground">{formatTime(file.modifiedAt)}</TableCell>
                      <TableCell className="py-1 text-right">
                        <Button size="xs" variant="outline" onClick={() => start.mutate(file)} disabled={start.isPending} aria-label={`Run ${file.name}`}>
                          <PlayIcon aria-hidden="true" />
                          Run
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Pipeline</CardTitle>
            <CardDescription>
              {runId ? (
                <>
                  Run <span className="font-mono">{runId}</span>
                  {run ? `, ${run.name}, ${run.domain}, ${run.rows.toLocaleString("en-US")} rows, ${run.sensorCount} sensors` : ""}
                  {run?.error ? `. ${run.error}` : ""}
                </>
              ) : (
                "Stages run in a fixed order. The health gate runs before drift and diagnosis."
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Progress value={(doneCount / stages.length) * 100} aria-label="Pipeline progress" />
            <ol className="flex flex-col">
              {stages.map((stage) => {
                const Icon = statusIcon[stage.status];
                return (
                  <li key={stage.name} className="flex items-center gap-3 border-b py-1.5 text-sm last:border-0">
                    <Icon className={cn("size-4 shrink-0", stage.status === "running" && "animate-spin", stage.status === "pending" && "text-muted-foreground")} aria-hidden="true" />
                    <span className="sr-only">{stage.status}</span>
                    <span className={cn("w-36 shrink-0", stage.status === "pending" && "text-muted-foreground")}>{stage.name}</span>
                    <span className="flex flex-1 flex-wrap gap-x-3 font-mono text-xs text-muted-foreground">
                      {Object.entries(stage.counts).map(([key, value]) => (
                        <span key={key}>
                          {key} {value.toLocaleString("en-US")}
                        </span>
                      ))}
                    </span>
                    <span className="w-16 text-right font-mono text-xs tabular-nums">{formatMs(stage.ms)}</span>
                  </li>
                );
              })}
            </ol>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
