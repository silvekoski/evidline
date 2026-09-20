import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { ArrowLeftIcon, ChevronDownIcon, ChevronUpIcon, ExternalLinkIcon, PanelRightIcon, SearchIcon, XIcon } from "lucide-react";
import { cn } from "cn";
import type { Segment } from "@tpm/schemas";
import { getSource, keys } from "@/api";
import { EmptyState } from "@/components/empty-state";
import { sourceIcon } from "@/components/knowledge/badges";
import { PageViewer } from "@/components/knowledge/page-viewer";
import { normalize, OriginalView, pageOf, ReadingView, RowsView, TranscriptView, type Target } from "@/components/knowledge/segment-views";
import { SourceDetails } from "@/components/knowledge/source-details";
import { SourceMenu, externalName } from "@/components/knowledge/source-menu";
import { SourceStatusText, isBusy } from "@/components/knowledge/source-status";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const detailsKey = "tpm.source.details";
type View = "parsed" | "original";

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
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const detail = useQuery({ queryKey: keys.source(id), queryFn: () => getSource(id), refetchInterval: (q) => (q.state.data && isBusy(q.state.data.source.status) ? 2000 : false) });
  const [find, setFind] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const [view, setView] = useState<View>("parsed");
  const [details, setDetails] = useState(() => localStorage.getItem(detailsKey) !== "closed");
  useEffect(() => localStorage.setItem(detailsKey, details ? "open" : "closed"), [details]);

  const segments = useMemo(() => detail.data?.segments ?? [], [detail.data]);
  const needle = normalize(find);
  const matches = useMemo(() => (needle.length >= 2 ? segments.filter((s) => normalize(s.text).includes(needle)) : []), [segments, needle]);
  const quote = params.get("q");
  const target = useMemo<Target>(() => {
    if (needle.length >= 2) {
      const hit = matches[Math.min(matchIndex, Math.max(0, matches.length - 1))];
      return hit ? { seq: hit.seq, quote: find } : null;
    }
    const byQuote = quote ? segments.find((s) => normalize(s.text).includes(normalize(quote))) : undefined;
    const hit = byQuote ?? segments.find((s) => matchesTarget(s, params));
    return hit ? { seq: hit.seq, quote } : null;
  }, [segments, matches, matchIndex, needle, find, quote, params]);

  const source = detail.data?.source;
  const paged = source !== undefined && source.mediaType === "application/pdf" && source.pages !== null && source.pages > 0;
  const targetPage = target === null ? null : pageOf(segments.find((s) => s.seq === target.seq)!);
  const finding = needle.length >= 2 && targetPage !== null;
  const page = finding ? targetPage : Math.min(Math.max(Number(params.get("page")) || targetPage || 1, 1), source?.pages ?? 1);
  const setPage = (next: number) =>
    setParams(
      (prev) => {
        const out = new URLSearchParams(prev);
        out.set("page", String(next));
        out.delete("q");
        out.delete("char");
        return out;
      },
      { replace: true },
    );
  if (detail.isPending) return <Skeleton className="h-64 w-full" />;
  if (detail.isError || !source) return <EmptyState title="Source not available" description={detail.error?.message} />;

  const Icon = sourceIcon(source);
  const shown = paged ? segments.filter((s) => pageOf(s) === page) : segments;
  const transcript = source.kind === "teams_call" || source.kind === "voice_note" || (segments.length > 0 && segments.every((s) => s.locator.kind === "teams_call"));
  const rows = !paged && segments.length > 0 && segments.every((s) => s.locator.kind === "file" && s.locator.row !== null);
  const body =
    view === "original" ? (
      <OriginalView source={source} />
    ) : shown.length === 0 ? (
      <div className="p-6">
        <EmptyState title="No text yet" description={isBusy(source.status) ? "The pipeline processes this source." : paged ? "This page has no text segments." : "The source has no text segments."} />
      </div>
    ) : transcript ? (
      <TranscriptView source={source} segments={shown} target={target} />
    ) : rows ? (
      <RowsView segments={shown} target={target} />
    ) : (
      <ReadingView source={source} segments={shown} target={target} label={paged ? `Text on page ${page}` : "Text"} />
    );
  const stepMatch = (dir: 1 | -1) => matches.length && setMatchIndex((i) => (i + dir + matches.length) % matches.length);

  return (
    <div className="-m-4 flex h-[calc(100dvh-3rem)] flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
        <Button asChild variant="ghost" size="icon-sm" aria-label="Back to sources">
          <Link to="/sources">
            <ArrowLeftIcon aria-hidden="true" />
          </Link>
        </Button>
        <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium" title={source.title}>
          {source.title}
        </h1>
        <SourceStatusText status={source.status} className="text-xs" />
        {view === "parsed" && segments.length > 0 && (
          <InputGroup className="w-full sm:w-72">
            <InputGroupAddon>
              <SearchIcon aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput
              type="search"
              placeholder="Find in document"
              aria-label="Find in document"
              value={find}
              onChange={(e) => {
                setFind(e.target.value);
                setMatchIndex(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  stepMatch(e.shiftKey ? -1 : 1);
                } else if (e.key === "Escape") setFind("");
              }}
            />
            <InputGroupAddon align="inline-end" className="gap-0.5">
              {needle.length >= 2 && (
                <span className="px-1 font-mono text-xs tabular-nums" aria-live="polite">
                  {matches.length ? `${Math.min(matchIndex, matches.length - 1) + 1} of ${matches.length}` : "0 of 0"}
                </span>
              )}
              {find && (
                <>
                  <InputGroupButton size="icon-xs" aria-label="Previous match" disabled={matches.length === 0} onClick={() => stepMatch(-1)}>
                    <ChevronUpIcon aria-hidden="true" />
                  </InputGroupButton>
                  <InputGroupButton size="icon-xs" aria-label="Next match" disabled={matches.length === 0} onClick={() => stepMatch(1)}>
                    <ChevronDownIcon aria-hidden="true" />
                  </InputGroupButton>
                  <InputGroupButton size="icon-xs" aria-label="Clear the find" onClick={() => setFind("")}>
                    <XIcon aria-hidden="true" />
                  </InputGroupButton>
                </>
              )}
            </InputGroupAddon>
          </InputGroup>
        )}
        {source.blobPath && !paged && (
          <ToggleGroup type="single" variant="outline" size="sm" spacing={0} value={view} onValueChange={(v) => v && setView(v as View)} aria-label="View">
            <ToggleGroupItem value="parsed">Parsed</ToggleGroupItem>
            <ToggleGroupItem value="original">Original</ToggleGroupItem>
          </ToggleGroup>
        )}
        {source.externalUrl && (
          <Button asChild variant="outline" size="sm">
            <a href={source.externalUrl} target="_blank" rel="noreferrer">
              <ExternalLinkIcon aria-hidden="true" /> Open in {externalName(source)}
            </a>
          </Button>
        )}
        <SourceMenu source={source} showOpen={false} onDeleted={() => navigate("/sources")} />
        <Button variant="ghost" size="icon-sm" aria-label="Details" aria-pressed={details} aria-controls="source-details" onClick={() => setDetails((d) => !d)}>
          <PanelRightIcon aria-hidden="true" />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col">
          {paged ? (
            <PageViewer source={source} page={page} onPage={setPage}>
              <div className="relative max-h-72 shrink-0 overflow-y-auto border-t xl:max-h-none xl:w-96 xl:border-t-0 xl:border-l">{body}</div>
            </PageViewer>
          ) : (
            <div className="relative min-h-0 flex-1 overflow-y-auto">{body}</div>
          )}
        </main>
        <aside id="source-details" aria-label="Source details" className={cn("relative w-80 shrink-0 overflow-y-auto border-l", !details && "hidden")}>
          <SourceDetails source={source} />
        </aside>
      </div>
    </div>
  );
}
