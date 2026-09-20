import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { BookOpenIcon, ChevronDownIcon, LayoutGridIcon, LinkIcon, ListIcon, MicIcon, PlusIcon, SearchIcon, SquareIcon, TagsIcon, TriangleAlertIcon, UploadIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { SourceKind, SourceStatus, type Source } from "@tpm/schemas";
import { createUploadLink, getCorpusStats, keys, listSources, uploadSources } from "@/api";
import { DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { FilePicker } from "@/components/file-picker";
import { useAliasImport } from "@/components/knowledge/alias-import";
import { sourceIcon, sourceKindWord, sourceStatusWord } from "@/components/knowledge/badges";
import { DropZone } from "@/components/knowledge/drop-zone";
import { SourceGrid } from "@/components/knowledge/source-grid";
import { SourceMenu } from "@/components/knowledge/source-menu";
import { SourceStatusText, isBusy, needsAttention } from "@/components/knowledge/source-status";
import { useVoiceRecorder } from "@/components/knowledge/use-voice-recorder";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatBytes, formatNumber, formatTime } from "@/lib/format";

export const uploadAccept = ".pdf,.docx,.pptx,.txt,.md,.vtt,.eml,.csv,.xlsx,audio/*,.m4a,.mp3,.wav,.ogg,.webm";
const viewKey = "tpm.sources.view";
type View = "list" | "grid";

const columns: ColumnDef<Source>[] = [
  {
    accessorKey: "title",
    header: "Name",
    meta: { className: "w-full max-w-0" },
    cell: ({ row }) => {
      const Icon = sourceIcon(row.original);
      return (
        <span className="flex items-center gap-2.5">
          <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0">
            <Link to={`/sources/${row.original.id}`} className="block truncate font-medium underline-offset-4 hover:underline" title={row.original.title}>
              {row.original.title}
            </Link>
            {row.original.error && (
              <span className="block truncate text-xs text-muted-foreground" title={row.original.error}>
                {row.original.error}
              </span>
            )}
          </span>
        </span>
      );
    },
  },
  { accessorKey: "kind", header: "Kind", meta: { className: "whitespace-nowrap text-muted-foreground" }, cell: ({ getValue }) => sourceKindWord(getValue<Source["kind"]>()) },
  { accessorKey: "occurredAt", header: "Date", meta: { className: "whitespace-nowrap" }, cell: ({ getValue }) => formatTime(getValue<string>()) },
  {
    accessorKey: "status",
    header: "Status",
    meta: { className: "whitespace-nowrap" },
    cell: ({ row }) => (
      <span className="flex flex-col">
        <SourceStatusText status={row.original.status} />
        {row.original.runId && (
          <Link to={`/runs/${row.original.runId}/sensors`} className="font-mono text-xs underline-offset-4 hover:underline">
            run {row.original.runId}
          </Link>
        )}
      </span>
    ),
  },
  { accessorKey: "chunks", header: "Chunks", meta: { numeric: true } },
  { accessorKey: "claims", header: "Claims", meta: { numeric: true } },
  { accessorKey: "bytes", header: "Size", meta: { numeric: true, className: "whitespace-nowrap" }, cell: ({ getValue }) => formatBytes(getValue<number>()) },
  {
    id: "actions",
    header: () => <span className="sr-only">Actions</span>,
    enableSorting: false,
    meta: { className: "w-10 pr-1" },
    cell: ({ row }) => (
      <span className="flex justify-end opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100">
        <SourceMenu source={row.original} />
      </span>
    ),
  },
];

function CorpusSummary() {
  const stats = useQuery({ queryKey: keys.corpusStats, queryFn: getCorpusStats, refetchInterval: 5000 });
  if (!stats.data) return <Skeleton className="h-4 w-96" />;
  const s = stats.data;
  const link = "underline-offset-4 hover:underline";
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground" aria-label="Corpus summary">
      <span>{formatNumber(s.sources)} sources</span>
      <span aria-hidden="true">·</span>
      <span>{formatNumber(s.chunks)} chunks</span>
      <span aria-hidden="true">·</span>
      <Link to="/claims" className={link}>
        {formatNumber(s.claims)} claims
      </Link>
      {s.claimsRejected > 0 && <span>({formatNumber(s.claimsRejected)} rejected by the quote check)</span>}
      <span aria-hidden="true">·</span>
      {s.columns === 0 ? (
        <Link to="/" className={link}>
          No columns yet, run a sensor file
        </Link>
      ) : (
        <span>{formatNumber(s.columns)} columns</span>
      )}
      <span aria-hidden="true">·</span>
      <Link to="/connectors" className={link}>
        {s.jobsQueued} jobs queued{s.jobsFailed > 0 && `, ${s.jobsFailed} failed`}
      </Link>
      <span aria-hidden="true">·</span>
      <span className="font-mono">{s.embedder ?? "no embedder"}</span>
      {s.dimensions ? <span>({s.dimensions} dimensions)</span> : null}
    </p>
  );
}

export function SourcesScreen() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const kind = params.get("kind") ?? "all";
  const status = params.get("status") ?? "all";
  const q = params.get("q") ?? "";
  const setParam = (key: string, value: string) =>
    setParams(
      (prev) => {
        const out = new URLSearchParams(prev);
        if (value && value !== "all") out.set(key, value);
        else out.delete(key);
        return out;
      },
      { replace: true },
    );
  const [view, setView] = useState<View>(() => (localStorage.getItem(viewKey) === "list" ? "list" : "grid"));
  useEffect(() => localStorage.setItem(viewKey, view), [view]);
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !(e.target instanceof HTMLElement && e.target.closest("input, textarea, [contenteditable]"))) {
        e.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const query = [kind !== "all" && `kind=${kind}`, status !== "all" && `status=${status}`].filter(Boolean).join("&");
  const sources = useQuery({ queryKey: keys.sources(query), queryFn: () => listSources(query), refetchInterval: (r) => (r.state.data?.some((s) => isBusy(s.status)) ? 2000 : 10000) });
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? (sources.data ?? []).filter((s) => s.title.toLowerCase().includes(needle)) : (sources.data ?? []);
  }, [sources.data, q]);

  const upload = useMutation({
    mutationFn: uploadSources,
    onSuccess: (list) => {
      void queryClient.invalidateQueries({ queryKey: ["sources"] });
      toast.success(`${list.length} file${list.length === 1 ? "" : "s"} received`, { description: "The pipeline reads the text, makes chunks, and extracts claims." });
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
  const aliases = useAliasImport();
  const recorder = useVoiceRecorder((file) => upload.mutate([file]));

  const attention = status === "all" ? (sources.data ?? []).filter((s) => needsAttention(s.status)) : [];
  const failed = attention.filter((s) => s.status === "failed").length;
  const needsOcr = attention.length - failed;
  const filtered = kind !== "all" || status !== "all" || q !== "";

  return (
    <>
      <PageHeader title="Sources" description="Every call transcript, thread, email, and file in this workspace. Each claim points back to one of these.">
        <FilePicker accept={uploadAccept} multiple label="Upload files" onFiles={(files) => upload.mutate(files)}>
          {(pickFiles) => (
            <FilePicker accept=".csv,text/csv" label="Import a tag list" onFiles={(files) => aliases.mutate(files[0]!)}>
              {(pickTags) => (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" disabled={upload.isPending}>
                      <PlusIcon aria-hidden="true" /> New <ChevronDownIcon aria-hidden="true" data-icon="inline-end" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuItem onSelect={pickFiles}>
                      <UploadIcon aria-hidden="true" /> Upload files
                    </DropdownMenuItem>
                    {recorder.supported && (
                      <DropdownMenuItem onSelect={() => void recorder.start()} disabled={recorder.recording}>
                        <MicIcon aria-hidden="true" /> Record a voice note
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => link.mutate()} disabled={link.isPending}>
                      <LinkIcon aria-hidden="true" /> Copy an upload link
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={pickTags} disabled={aliases.isPending}>
                      <TagsIcon aria-hidden="true" /> Import a tag list
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </FilePicker>
          )}
        </FilePicker>
      </PageHeader>

      {(recorder.recording || recorder.error) && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border p-2 text-sm" role="status">
          <MicIcon aria-hidden="true" className={recorder.recording ? "size-4 motion-safe:animate-pulse" : "size-4 text-muted-foreground"} />
          <span className="flex-1">{recorder.recording ? `Recording, ${recorder.seconds} s. The audio stays in the browser until you stop.` : recorder.error}</span>
          {recorder.recording && (
            <Button size="sm" onClick={recorder.stop}>
              <SquareIcon aria-hidden="true" /> Stop and upload
            </Button>
          )}
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <InputGroup className="w-full sm:w-72">
          <InputGroupAddon>
            <SearchIcon aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput ref={search} type="search" placeholder="Search sources" aria-label="Search sources by name" value={q} onChange={(e) => setParam("q", e.target.value)} />
          <InputGroupAddon align="inline-end">
            {q ? (
              <InputGroupButton size="icon-xs" aria-label="Clear the search" onClick={() => setParam("q", "")}>
                <XIcon aria-hidden="true" />
              </InputGroupButton>
            ) : (
              <Kbd>/</Kbd>
            )}
          </InputGroupAddon>
        </InputGroup>
        <Select value={kind} onValueChange={(v) => setParam("kind", v)}>
          <SelectTrigger size="sm" aria-label="Kind" className="rounded-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All kinds</SelectItem>
            {SourceKind.options.map((k) => (
              <SelectItem key={k} value={k}>
                {sourceKindWord(k)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => setParam("status", v)}>
          <SelectTrigger size="sm" aria-label="Status" className="rounded-full">
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
        {filtered && (
          <Button variant="ghost" size="sm" onClick={() => setParams({}, { replace: true })}>
            <XIcon aria-hidden="true" /> Clear
          </Button>
        )}
        <span className="ml-auto text-xs text-muted-foreground" aria-live="polite">
          {sources.data ? (filtered ? `${shown.length} of ${sources.data.length}` : `${sources.data.length}`) : ""}
        </span>
        <ToggleGroup type="single" variant="outline" size="sm" spacing={0} value={view} onValueChange={(v) => v && setView(v as View)} aria-label="View">
          <ToggleGroupItem value="list" aria-label="List view">
            <ListIcon aria-hidden="true" />
          </ToggleGroupItem>
          <ToggleGroupItem value="grid" aria-label="Grid view">
            <LayoutGridIcon aria-hidden="true" />
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {attention.length > 0 && (
        <p className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-dashed p-2 text-sm" role="status">
          <TriangleAlertIcon aria-hidden="true" className="size-4" />
          <span>{attention.length === 1 ? "1 source needs" : `${attention.length} sources need`} attention.</span>
          {failed > 0 && (
            <Button size="xs" variant="outline" onClick={() => setParam("status", "failed")}>
              {failed} failed
            </Button>
          )}
          {needsOcr > 0 && (
            <Button size="xs" variant="outline" onClick={() => setParam("status", "needs_ocr")}>
              {needsOcr} {needsOcr === 1 ? "needs" : "need"} OCR
            </Button>
          )}
        </p>
      )}

      <DropZone onFiles={(files) => upload.mutate(files)} disabled={upload.isPending} className="min-h-64 flex-1">
        {sources.isPending ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : sources.isError ? (
          <EmptyState title="Sources not available" description={sources.error.message} />
        ) : sources.data.length === 0 ? (
          <EmptyState icon={BookOpenIcon} title="No sources yet" description="Drop a transcript, an email, or a document anywhere on this page. Supported: PDF, DOCX, PPTX, TXT, MD, VTT, EML, CSV, XLSX, and audio (M4A, MP3, WAV, OGG, WEBM).">
            <FilePicker accept={uploadAccept} multiple label="Upload files" onFiles={(files) => upload.mutate(files)}>
              {(pick) => (
                <Button size="sm" onClick={pick}>
                  <UploadIcon aria-hidden="true" /> Upload files
                </Button>
              )}
            </FilePicker>
          </EmptyState>
        ) : shown.length === 0 ? (
          <EmptyState icon={SearchIcon} title="No match" description={`No source name contains "${q.trim()}".`}>
            <Button size="sm" variant="outline" onClick={() => setParam("q", "")}>
              Clear the search
            </Button>
          </EmptyState>
        ) : view === "grid" ? (
          <SourceGrid sources={shown} />
        ) : (
          <div className="rounded-lg border">
            <DataTable
              label="Sources"
              columns={columns}
              data={shown}
              getRowId={(s) => String(s.id)}
              initialSorting={[{ id: "occurredAt", desc: true }]}
              pagination
              rowProps={(row) => ({
                className: "group/row cursor-pointer",
                onClick: (e) => {
                  if (e.target instanceof HTMLElement && e.target.closest("a, button, [role=menu]")) return;
                  navigate(`/sources/${row.original.id}`);
                },
              })}
            />
          </div>
        )}
      </DropZone>
      <div className="mt-3">
        <CorpusSummary />
      </div>
    </>
  );
}
