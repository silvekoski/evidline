import { useEffect, useRef, type ComponentProps, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "cn";
import type { Segment, Source } from "@tpm/schemas";
import { getSourceBlobText, keys, sourceBlobUrl } from "@/api";
import { EmptyState } from "@/components/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useScrollTarget } from "@/hooks/use-scroll-target";
import { formatTime } from "@/lib/format";
import { OcrBadge } from "./badges";
import { formatClock } from "./locator";

export const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
export const pageOf = (s: Segment): number | null => (s.locator.kind === "file" ? s.locator.page : null);
const rowOf = (s: Segment): number | null => (s.locator.kind === "file" ? s.locator.row : null);

export type Target = { seq: number; quote: string | null } | null;

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

function Passage({ segment, target, className, children }: { segment: Segment; target: Target; className?: string; children?: ReactNode }) {
  const active = target?.seq === segment.seq;
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [active, target?.quote]);
  return (
    <li ref={ref} id={`seg-${segment.seq}`} aria-current={active ? "true" : undefined} className={cn("rounded-md transition-colors", active && "bg-muted ring-1 ring-foreground", className)}>
      {children}
      <p className="whitespace-pre-wrap">
        <Highlight text={segment.text} quote={active ? target.quote : null} />
      </p>
    </li>
  );
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

export function TranscriptView({ source, segments, target }: { source: Source; segments: Segment[]; target: Target }) {
  const groups: Segment[][] = [];
  for (const s of segments) {
    const last = groups[groups.length - 1];
    if (last && last[0]!.speaker === s.speaker) last.push(s);
    else groups.push([s]);
  }
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      {source.mediaType.startsWith("audio/") && source.blobPath && <audio controls preload="metadata" src={sourceBlobUrl(source.id)} className="w-full" aria-label={`Audio of ${source.title}`} />}
      <ol className="flex flex-col gap-5" aria-label="Transcript">
        {groups.map((group) => {
          const first = group[0]!;
          const speaker = first.speaker ?? "Unknown speaker";
          const start = first.locator.kind === "teams_call" ? formatClock(first.locator.startMs) : null;
          return (
            <li key={first.id} className="grid grid-cols-[2rem_1fr] gap-3">
              <span aria-hidden="true" className="flex size-8 items-center justify-center rounded-full border font-mono text-xs text-muted-foreground">
                {initials(speaker) || "?"}
              </span>
              <div className="min-w-0">
                <p className="mb-1 flex items-baseline gap-2 text-sm">
                  <span className="font-medium">{speaker}</span>
                  {start && <span className="font-mono text-xs text-muted-foreground">{start}</span>}
                </p>
                <ol className="flex flex-col gap-1 text-sm">
                  {group.map((s) => (
                    <Passage key={s.id} segment={s} target={target} className="-mx-2 px-2 py-1" />
                  ))}
                </ol>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function RowsView({ segments, target }: { segments: Segment[]; target: Target }) {
  useScrollTarget(target ? `seg-${target.seq}` : null);
  const sheets = new Map<string | null, Segment[]>();
  for (const s of segments) {
    const sheet = s.locator.kind === "file" ? s.locator.sheet : null;
    sheets.set(sheet, [...(sheets.get(sheet) ?? []), s]);
  }
  return (
    <div className="flex flex-col gap-6 p-6">
      {[...sheets].map(([sheet, rows]) => (
        <section key={sheet ?? ""} aria-label={sheet ? `Sheet ${sheet}` : "Rows"}>
          {sheet && sheets.size > 1 && <h2 className="mb-2 font-mono text-xs text-muted-foreground">Sheet {sheet}</h2>}
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="h-8 w-16 text-right">Row</TableHead>
                  <TableHead className="h-8">Content</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((s) => {
                  const active = target?.seq === s.seq;
                  return (
                    <TableRow key={s.id} id={`seg-${s.seq}`} aria-current={active ? "true" : undefined} className={cn(active && "bg-muted")}>
                      <TableCell className="py-1 text-right font-mono text-xs text-muted-foreground tabular-nums">{rowOf(s) ?? s.seq + 1}</TableCell>
                      <TableCell className="py-1 font-mono text-xs whitespace-pre-wrap">
                        <Highlight text={s.text} quote={active ? target.quote : null} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </section>
      ))}
    </div>
  );
}

export function ReadingView({ source, segments, target, label }: { source: Source; segments: Segment[]; target: Target; label: string }) {
  const gutter = segments.length > 1;
  return (
    <article className="mx-auto max-w-3xl p-6">
      {source.kind === "email" && (
        <header className="mb-6 border-b pb-4">
          <h2 className="text-base font-medium">{source.title}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{formatTime(source.occurredAt)}</p>
        </header>
      )}
      <ol className="flex flex-col gap-3 text-sm leading-relaxed" aria-label={label}>
        {segments.map((s) => {
          const page = pageOf(s);
          const fromOcr = page !== null && source.ocrPages.includes(page);
          return (
            <Passage key={s.id} segment={s} target={target} className={cn("-mx-2 px-2 py-1", gutter && "grid grid-cols-[3rem_1fr] gap-3")}>
              {gutter && (
                <span className="flex flex-col items-end gap-1 pt-0.5 font-mono text-xs text-muted-foreground select-none">
                  <span aria-label={`Segment ${s.seq + 1}`}>{s.seq + 1}</span>
                  {fromOcr && <OcrBadge className="font-sans" />}
                </span>
              )}
            </Passage>
          );
        })}
      </ol>
    </article>
  );
}

const markdownComponents = {
  h1: (p: ComponentProps<"h1">) => <h1 className="mt-6 mb-2 text-lg font-semibold first:mt-0" {...p} />,
  h2: (p: ComponentProps<"h2">) => <h2 className="mt-6 mb-2 text-base font-semibold first:mt-0" {...p} />,
  h3: (p: ComponentProps<"h3">) => <h3 className="mt-4 mb-2 text-sm font-semibold first:mt-0" {...p} />,
  p: (p: ComponentProps<"p">) => <p className="mb-3 leading-relaxed last:mb-0" {...p} />,
  ul: (p: ComponentProps<"ul">) => <ul className="mb-3 list-disc pl-5" {...p} />,
  ol: (p: ComponentProps<"ol">) => <ol className="mb-3 list-decimal pl-5" {...p} />,
  li: (p: ComponentProps<"li">) => <li className="mb-1" {...p} />,
  a: (p: ComponentProps<"a">) => <a className="underline underline-offset-2 hover:text-foreground" target="_blank" rel="noreferrer" {...p} />,
  code: (p: ComponentProps<"code">) => <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs" {...p} />,
  pre: (p: ComponentProps<"pre">) => <pre className="mb-3 overflow-x-auto rounded-md border bg-muted/40 p-3 font-mono text-xs" {...p} />,
  blockquote: (p: ComponentProps<"blockquote">) => <blockquote className="mb-3 border-l-2 pl-3 text-muted-foreground italic" {...p} />,
  hr: () => <hr className="my-4 border-border" />,
  table: (p: ComponentProps<"table">) => <Table className="mb-3" {...p} />,
  thead: (p: ComponentProps<"thead">) => <TableHeader {...p} />,
  tbody: (p: ComponentProps<"tbody">) => <TableBody {...p} />,
  tr: (p: ComponentProps<"tr">) => <TableRow {...p} />,
  th: (p: ComponentProps<"th">) => <TableHead {...p} />,
  td: (p: ComponentProps<"td">) => <TableCell {...p} />,
};

const TEXT_MEDIA_TYPES = new Set(["text/plain", "text/csv", "message/rfc822"]);

export function OriginalView({ source }: { source: Source }) {
  const blob = useQuery({ queryKey: keys.sourceBlobText(source.id), queryFn: () => getSourceBlobText(source.id), enabled: source.mediaType === "text/markdown" || TEXT_MEDIA_TYPES.has(source.mediaType) });
  if (source.mediaType !== "text/markdown" && !TEXT_MEDIA_TYPES.has(source.mediaType)) {
    return (
      <div className="p-6">
        <EmptyState title="No inline preview for this file type">
          <a href={sourceBlobUrl(source.id)} target="_blank" rel="noreferrer" className="underline underline-offset-2">
            Open the original file in a new tab
          </a>
        </EmptyState>
      </div>
    );
  }
  if (blob.isPending) return <Skeleton className="m-6 h-64" />;
  if (blob.isError)
    return (
      <div className="p-6">
        <EmptyState title="Could not load the original" description={blob.error.message} />
      </div>
    );
  return (
    <article className="mx-auto max-w-3xl p-6 text-sm">
      {source.mediaType === "text/markdown" ? <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{blob.data}</ReactMarkdown> : <pre className="font-mono text-xs whitespace-pre-wrap">{blob.data}</pre>}
    </article>
  );
}
