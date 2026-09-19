import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { BookOpenIcon, LinkIcon, UploadIcon } from "lucide-react";
import { toast } from "sonner";
import { SourceKind, SourceStatus, type Source } from "@tpm/schemas";
import { createUploadLink, getCorpusStats, keys, listSources, uploadSources } from "@/api";
import { DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { SourceKindBadge, sourceStatusWord } from "@/components/knowledge/badges";
import { VoiceRecorder } from "@/components/knowledge/voice-recorder";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBytes, formatTime } from "@/lib/format";

const columns: ColumnDef<Source>[] = [
  { accessorKey: "title", header: "Title", cell: ({ row }) => <Link to={`/sources/${row.original.id}`} className="underline-offset-4 hover:underline">{row.original.title}</Link> },
  { accessorKey: "kind", header: "Kind", cell: ({ getValue }) => <SourceKindBadge value={getValue<Source["kind"]>()} /> },
  { accessorKey: "occurredAt", header: "Date", cell: ({ getValue }) => formatTime(getValue<string>()) },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <span title={row.original.error ?? undefined}>
        {sourceStatusWord[row.original.status]}
        {row.original.error && <span className="block max-w-xs truncate text-xs text-muted-foreground">{row.original.error}</span>}
        {row.original.runId && (
          <Link to={`/runs/${row.original.runId}/sensors`} className="block font-mono text-xs underline-offset-4 hover:underline">
            run {row.original.runId}
          </Link>
        )}
      </span>
    ),
  },
  { accessorKey: "chunks", header: "Chunks", meta: { numeric: true } },
  { accessorKey: "claims", header: "Claims", meta: { numeric: true } },
  { accessorKey: "bytes", header: "Size", meta: { numeric: true }, cell: ({ getValue }) => formatBytes(getValue<number>()) },
];

function StatCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="font-mono text-xl tabular-nums">{value}</CardTitle>
      </CardHeader>
      {hint && <CardContent className="text-xs text-muted-foreground">{hint}</CardContent>}
    </Card>
  );
}

export function SourcesScreen() {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const input = useRef<HTMLInputElement>(null);
  const query = [kind !== "all" && `kind=${kind}`, status !== "all" && `status=${status}`].filter(Boolean).join("&");
  const sources = useQuery({ queryKey: keys.sources(query), queryFn: () => listSources(query), refetchInterval: (q) => (q.state.data?.some((s) => s.status === "received" || s.status === "processing") ? 2000 : 10000) });
  const stats = useQuery({ queryKey: keys.corpusStats, queryFn: getCorpusStats, refetchInterval: 5000 });
  const upload = useMutation({
    mutationFn: uploadSources,
    onSuccess: (list) => {
      void queryClient.invalidateQueries({ queryKey: ["sources"] });
      toast.success(`${list.length} file${list.length === 1 ? "" : "s"} received`);
    },
  });
  const link = useMutation({
    mutationFn: () => createUploadLink(72),
    onSuccess: async (made) => {
      const url = `${window.location.origin}${made.url}`;
      await navigator.clipboard.writeText(url).catch(() => undefined);
      toast.success("Upload link copied", { description: `${url} is valid until ${formatTime(made.expiresAt)}` });
    },
  });

  return (
    <>
      <PageHeader title="Sources" description="Every call transcript, thread, email, and file in this workspace. Each claim points back to one of these.">
        <Select value={kind} onValueChange={setKind}>
          <SelectTrigger size="sm" aria-label="Kind">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All kinds</SelectItem>
            {SourceKind.options.map((k) => (
              <SelectItem key={k} value={k}>
                {k.replace("_", " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger size="sm" aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {SourceStatus.options.map((s) => (
              <SelectItem key={s} value={s}>
                {sourceStatusWord[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={() => link.mutate()} disabled={link.isPending}>
          <LinkIcon aria-hidden="true" /> Upload link
        </Button>
        <input
          ref={input}
          type="file"
          multiple
          className="sr-only"
          aria-label="Upload files"
          accept=".pdf,.docx,.pptx,.txt,.md,.vtt,.eml,.csv,.xlsx,audio/*,.m4a,.mp3,.wav,.ogg,.webm"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length) upload.mutate(files);
            e.target.value = "";
          }}
        />
        <Button size="sm" onClick={() => input.current?.click()} disabled={upload.isPending}>
          <UploadIcon aria-hidden="true" /> Upload
        </Button>
      </PageHeader>
      <div className="mb-3">
        <VoiceRecorder onRecorded={(file) => upload.mutate([file])} disabled={upload.isPending} />
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Sources" value={stats.data?.sources ?? "…"} />
        <StatCard label="Chunks" value={stats.data?.chunks ?? "…"} />
        <StatCard label="Claims" value={stats.data?.claims ?? "…"} hint={stats.data ? `${stats.data.claimsRejected} rejected by the quote check` : undefined} />
        <StatCard label="Columns" value={stats.data?.columns ?? "…"} />
        <StatCard label="Jobs" value={stats.data ? `${stats.data.jobsQueued} queued` : "…"} hint={stats.data ? `${stats.data.jobsFailed} failed` : undefined} />
        <StatCard label="Embedder" value={stats.data?.embedder ?? "none"} hint={stats.data?.dimensions ? `${stats.data.dimensions} dimensions` : undefined} />
      </div>
      <div
        className="rounded-lg border border-dashed"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const files = Array.from(e.dataTransfer.files);
          if (files.length) upload.mutate(files);
        }}
      >
        {sources.isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : sources.isError ? (
          <EmptyState title="Sources not available" description={sources.error.message} />
        ) : sources.data.length === 0 ? (
          <EmptyState icon={BookOpenIcon} title="No sources" description="Drop a transcript, an email, or a document here. Supported: PDF, DOCX, PPTX, TXT, MD, VTT, EML, CSV, XLSX, and audio (M4A, MP3, WAV, OGG, WEBM)." />
        ) : (
          <DataTable label="Sources" columns={columns} data={sources.data} getRowId={(s) => String(s.id)} initialSorting={[{ id: "occurredAt", desc: true }]} pagination />
        )}
      </div>
    </>
  );
}
