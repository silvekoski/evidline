import { useEffect, useMemo, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { ExternalLinkIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import { cn } from "cn";
import type { Segment } from "@tpm/schemas";
import { deleteSource, getSource, getSourceClaims, keys, reprocessSource, sourceBlobUrl } from "@/api";
import { EmptyState } from "@/components/empty-state";
import { SourceKindBadge, sourceStatusWord } from "@/components/knowledge/badges";
import { ClaimCard } from "@/components/knowledge/claim-card";
import { formatClock } from "@/components/knowledge/locator";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBytes, formatTime } from "@/lib/format";

const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

function Highlight({ text, quote }: { text: string; quote: string | null }) {
  if (!quote) return <>{text}</>;
  const at = normalize(text).indexOf(normalize(quote));
  if (at < 0) return <>{text}</>;
  const collapsed = text.replace(/\s+/g, " ");
  const end = at + normalize(quote).length;
  return (
    <>
      {collapsed.slice(0, at)}
      <mark className="rounded bg-foreground px-0.5 text-background">{collapsed.slice(at, end)}</mark>
      {collapsed.slice(end)}
    </>
  );
}

function matchesTarget(segment: Segment, params: URLSearchParams): boolean {
  const l = segment.locator;
  const at = params.get("at");
  const page = params.get("page");
  const row = params.get("row");
  const char = params.get("char");
  if (l.kind === "teams_call" && at !== null) return Number(at) >= l.startMs && Number(at) <= l.endMs;
  if (l.kind === "file" && page !== null) return l.page === Number(page);
  if (l.kind === "file" && row !== null) return l.row === Number(row);
  if ((l.kind === "file" || l.kind === "email") && char !== null) return Number(char) >= l.charStart && Number(char) < Math.max(l.charEnd, l.charStart + 1);
  return false;
}

export function SourceScreen() {
  const id = Number(useParams().sourceId);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const detail = useQuery({ queryKey: keys.source(id), queryFn: () => getSource(id), refetchInterval: (q) => (q.state.data?.source.status === "processing" || q.state.data?.source.status === "received" ? 2000 : false) });
  const claims = useQuery({ queryKey: keys.sourceClaims(id), queryFn: () => getSourceClaims(id), refetchInterval: 5000 });
  const reprocess = useMutation({ mutationFn: () => reprocessSource(id), onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.source(id) }) });
  const remove = useMutation({ mutationFn: () => deleteSource(id), onSuccess: () => navigate("/sources") });
  const quote = params.get("q");
  const target = useRef<HTMLLIElement>(null);
  const targetSeq = useMemo(() => {
    const segments = detail.data?.segments ?? [];
    const byQuote = quote ? segments.find((s) => normalize(s.text).includes(normalize(quote))) : undefined;
    return (byQuote ?? segments.find((s) => matchesTarget(s, params)))?.seq ?? null;
  }, [detail.data, params, quote]);
  useEffect(() => {
    target.current?.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [targetSeq]);

  if (detail.isPending) return <Skeleton className="h-64 w-full" />;
  if (detail.isError) return <EmptyState title="Source not available" description={detail.error.message} />;
  const { source, segments } = detail.data;
  const page = params.get("page");
  const blobHref = source.blobPath ? `${sourceBlobUrl(source.id)}${source.mediaType === "application/pdf" && page ? `#page=${page}` : ""}` : null;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div>
        <PageHeader title={source.title} description={`${formatTime(source.occurredAt)}, ${sourceStatusWord[source.status]}, ${formatBytes(source.bytes)}, ${segments.length} segments, ${source.chunks} chunks`}>
          <SourceKindBadge value={source.kind} />
          {blobHref && (
            <Button asChild variant="outline" size="sm">
              <a href={blobHref} target="_blank" rel="noreferrer">
                <ExternalLinkIcon aria-hidden="true" /> Original{page ? `, page ${page}` : ""}
              </a>
            </Button>
          )}
          {source.externalUrl && (
            <Button asChild variant="outline" size="sm">
              <a href={source.externalUrl} target="_blank" rel="noreferrer">
                <ExternalLinkIcon aria-hidden="true" /> Open in {source.kind === "slack_thread" ? "Slack" : "Teams"}
              </a>
            </Button>
          )}
          {source.runId && (
            <Button asChild variant="outline" size="sm">
              <Link to={`/runs/${source.runId}/sensors`}>Run {source.runId}</Link>
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => reprocess.mutate()} disabled={reprocess.isPending}>
            <RefreshCwIcon aria-hidden="true" /> Process again
          </Button>
          <Button variant="ghost" size="sm" aria-label="Delete this source" onClick={() => confirm(`Delete ${source.title} with its chunks, vectors, and claims?`) && remove.mutate()}>
            <Trash2Icon aria-hidden="true" />
          </Button>
        </PageHeader>
        {source.error && <p className="mb-3 rounded-md border p-2 text-sm">{source.error}</p>}
        {segments.length === 0 ? (
          <EmptyState title="No text yet" description={source.status === "received" || source.status === "processing" ? "The pipeline processes this source." : "The source has no text segments."} />
        ) : (
          <ol className="flex flex-col gap-2" aria-label="Segments">
            {segments.map((s) => {
              const active = s.seq === targetSeq;
              const l = s.locator;
              const where = l.kind === "teams_call" ? formatClock(l.startMs) : l.kind === "file" && l.page !== null ? `p. ${l.page}` : l.kind === "file" && l.row !== null ? `row ${l.row}` : String(s.seq + 1);
              return (
                <li key={s.id} id={`seg-${s.seq}`} ref={active ? target : undefined} className={cn("grid grid-cols-[4.5rem_1fr] gap-3 rounded-md border p-2 text-sm", active && "border-foreground")} aria-current={active ? "true" : undefined}>
                  <div className="flex flex-col font-mono text-xs text-muted-foreground">
                    <span>{where}</span>
                    {s.speaker && <span className="truncate font-sans" title={s.speaker}>{s.speaker}</span>}
                  </div>
                  <p className="whitespace-pre-wrap">
                    <Highlight text={s.text} quote={active ? quote : null} />
                  </p>
                </li>
              );
            })}
          </ol>
        )}
      </div>
      <aside aria-label="Claims from this source" className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Claims ({claims.data?.length ?? 0})</h2>
        {claims.data?.length === 0 && <p className="text-sm text-muted-foreground">No claim yet. Claims appear after the extraction job runs.</p>}
        {(claims.data ?? []).map((claim) => (
          <ClaimCard key={claim.id} claim={claim} showSource={false} />
        ))}
      </aside>
    </div>
  );
}
