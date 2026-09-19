import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { ChevronLeftIcon, ChevronRightIcon, ExternalLinkIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import { cn } from "cn";
import type { Segment, Source } from "@tpm/schemas";
import { deleteSource, getSource, getSourceClaims, keys, reprocessSource, sourceBlobUrl, sourcePageUrl } from "@/api";
import { ConfirmAction } from "@/components/confirm-action";
import { EmptyState } from "@/components/empty-state";
import { OcrBadge, SourceKindBadge, sourceStatusWord } from "@/components/knowledge/badges";
import { ClaimCard } from "@/components/knowledge/claim-card";
import { formatClock } from "@/components/knowledge/locator";
import { SourceSteps } from "@/components/knowledge/source-steps";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBytes, formatTime } from "@/lib/format";

const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const pageOf = (s: Segment): number | null => (s.locator.kind === "file" ? s.locator.page : null);
const listPages = (pages: number[]): string => (pages.length === 1 ? `page ${pages[0]}` : `pages ${pages.slice(0, -1).join(", ")} and ${pages[pages.length - 1]}`);

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

function PageImage({ source, page, onPage }: { source: Source; page: number; onPage: (page: number) => void }) {
  const [loaded, setLoaded] = useState<number | null>(null);
  const total = source.pages ?? 1;
  const fromOcr = source.ocrPages.includes(page);
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="flex items-center gap-2 text-sm">
        <Button variant="outline" size="icon-sm" aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <ChevronLeftIcon aria-hidden="true" />
        </Button>
        <span className="font-mono text-xs">
          Page {page} of {total}
        </span>
        <Button variant="outline" size="icon-sm" aria-label="Next page" disabled={page >= total} onClick={() => onPage(page + 1)}>
          <ChevronRightIcon aria-hidden="true" />
        </Button>
        {fromOcr && <OcrBadge />}
        <a href={`${sourceBlobUrl(source.id)}#page=${page}`} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:underline">
          <ExternalLinkIcon aria-hidden="true" className="size-3" /> Original
        </a>
      </figcaption>
      <div className="relative overflow-hidden rounded-md border bg-white">
        {loaded !== page && <Skeleton className="absolute inset-0 aspect-[1/1.41] w-full" />}
        <img key={page} src={sourcePageUrl(source.id, page)} alt={`Page ${page} of ${source.title}`} className={cn("w-full", loaded !== page && "invisible")} onLoad={() => setLoaded(page)} />
      </div>
    </figure>
  );
}

export function SourceScreen() {
  const id = Number(useParams().sourceId);
  const [params, setParams] = useSearchParams();
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
  const paged = source.mediaType === "application/pdf" && source.pages !== null && source.pages > 0;
  const targetPage = targetSeq === null ? null : pageOf(segments.find((s) => s.seq === targetSeq)!);
  const page = Math.min(Math.max(Number(params.get("page")) || targetPage || 1, 1), source.pages ?? 1);
  const setPage = (next: number) => setParams((prev) => {
    const out = new URLSearchParams(prev);
    out.set("page", String(next));
    out.delete("q");
    out.delete("char");
    return out;
  }, { replace: true });
  const shown = paged ? segments.filter((s) => pageOf(s) === page) : segments;
  const ocrRead = source.status === "processed" && source.ocrPages.length > 0;

  return (
    <div className={cn("grid gap-4", paged ? "lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,5fr)_minmax(0,4fr)_minmax(0,3fr)]" : "lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]")}>
      <div className={cn(paged && "lg:col-span-2 xl:col-span-3")}>
        <PageHeader title={source.title} description={`${formatTime(source.occurredAt)}, ${sourceStatusWord[source.status]}, ${formatBytes(source.bytes)}${source.pages ? `, ${source.pages} pages` : ""}`}>
          <SourceKindBadge value={source.kind} />
          {source.blobPath && !paged && (
            <Button asChild variant="outline" size="sm">
              <a href={sourceBlobUrl(source.id)} target="_blank" rel="noreferrer">
                <ExternalLinkIcon aria-hidden="true" /> Original
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
          <ConfirmAction title={`Delete ${source.title}?`} description="The source goes away with its segments, chunks, vectors, and claims. A claim that the data spec uses goes away too." action="Delete source" onConfirm={() => remove.mutate()} disabled={remove.isPending}>
            <Button variant="ghost" size="sm" aria-label="Delete this source">
              <Trash2Icon aria-hidden="true" />
            </Button>
          </ConfirmAction>
        </PageHeader>
        <SourceSteps source={source} className="mb-3" />
        {source.error && <p className="mb-3 rounded-md border p-2 text-sm">{source.error}</p>}
        {ocrRead && (
          <p className="mb-3 flex items-start gap-2 rounded-md border border-dashed p-2 text-sm">
            <OcrBadge className="shrink-0" />
            <span>A model read {listPages(source.ocrPages)} from the page image, because the PDF has no text layer there. Compare a quote from these pages with the page before you confirm a claim.</span>
          </p>
        )}
      </div>
      {paged && <PageImage source={source} page={page} onPage={setPage} />}
      <div>
        {shown.length === 0 ? (
          <EmptyState title="No text yet" description={source.status === "received" || source.status === "processing" ? "The pipeline processes this source." : paged ? "This page has no text segments." : "The source has no text segments."} />
        ) : (
          <ol className="flex flex-col gap-2" aria-label={paged ? `Segments on page ${page}` : "Segments"}>
            {shown.map((s) => {
              const active = s.seq === targetSeq;
              const l = s.locator;
              const fromOcr = l.kind === "file" && l.page !== null && source.ocrPages.includes(l.page);
              const where = l.kind === "teams_call" ? formatClock(l.startMs) : l.kind === "file" && l.page !== null ? `p. ${l.page}` : l.kind === "file" && l.row !== null ? `row ${l.row}` : String(s.seq + 1);
              return (
                <li key={s.id} id={`seg-${s.seq}`} ref={active ? target : undefined} className={cn("grid grid-cols-[4.5rem_1fr] gap-3 rounded-md border p-2 text-sm", active && "border-foreground")} aria-current={active ? "true" : undefined}>
                  <div className="flex flex-col items-start gap-1 font-mono text-xs text-muted-foreground">
                    <span>{where}</span>
                    {s.speaker && <span className="truncate font-sans" title={s.speaker}>{s.speaker}</span>}
                    {fromOcr && <OcrBadge className="font-sans" />}
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
