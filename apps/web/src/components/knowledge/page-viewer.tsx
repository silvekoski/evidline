import { useEffect, useState, type ReactNode } from "react";
import { ChevronLeftIcon, ChevronRightIcon, ExternalLinkIcon, MaximizeIcon, ZoomInIcon, ZoomOutIcon } from "lucide-react";
import { cn } from "cn";
import type { Source } from "@tpm/schemas";
import { sourceBlobUrl, sourcePageUrl } from "@/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { OcrBadge } from "./badges";

const zooms = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
type Zoom = "fit" | number;

const inField = (e: KeyboardEvent) => e.target instanceof HTMLElement && e.target.closest("input, textarea, select, [contenteditable]") !== null;

function PageInput({ page, total, onPage }: { page: number; total: number; onPage: (page: number) => void }) {
  const [draft, setDraft] = useState(String(page));
  useEffect(() => setDraft(String(page)), [page]);
  const commit = () => {
    const next = Number(draft);
    if (Number.isInteger(next) && next >= 1 && next <= total) onPage(next);
    else setDraft(String(page));
  };
  return (
    <label className="flex items-center gap-1.5 font-mono text-xs">
      <span className="sr-only">Page</span>
      <Input type="text" inputMode="numeric" value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} className="h-7 w-12 px-1.5 text-center font-mono text-xs" aria-label={`Page ${page} of ${total}, type a page number`} />
      <span className="whitespace-nowrap text-muted-foreground">of {total}</span>
    </label>
  );
}

export function PageViewer({ source, page, onPage, children }: { source: Source; page: number; onPage: (page: number) => void; children: ReactNode }) {
  const total = source.pages ?? 1;
  const [zoom, setZoom] = useState<Zoom>("fit");
  const [loaded, setLoaded] = useState<number | null>(null);
  const step = (dir: 1 | -1) => {
    const current = zoom === "fit" ? 1 : zoom;
    const next = dir === 1 ? zooms.find((z) => z > current) : [...zooms].reverse().find((z) => z < current);
    if (next) setZoom(next);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (inField(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowRight" || e.key === "PageDown") {
        if (page < total) onPage(page + 1);
        e.preventDefault();
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        if (page > 1) onPage(page - 1);
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [page, total, onPage]);

  return (
    <div className="flex min-h-0 flex-1">
      <nav aria-label="Pages" className="relative hidden w-28 shrink-0 overflow-y-auto border-r bg-muted/20 p-2 lg:block">
        <ol className="flex flex-col gap-2">
          {Array.from({ length: total }, (_, i) => i + 1).map((n) => (
            <li key={n}>
              <button
                type="button"
                onClick={() => onPage(n)}
                aria-current={n === page ? "page" : undefined}
                aria-label={`Page ${n}`}
                className={cn("flex w-full flex-col items-center gap-1 rounded-md p-1 outline-none focus-visible:ring-2 focus-visible:ring-ring", n === page ? "bg-muted" : "hover:bg-muted/60")}
              >
                <img src={sourcePageUrl(source.id, n)} alt="" loading="lazy" className={cn("w-full rounded-sm border bg-white", n === page && "border-foreground")} />
                <span className="font-mono text-[0.65rem] text-muted-foreground">{n}</span>
              </button>
            </li>
          ))}
        </ol>
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-1 border-b px-3 py-1.5">
          <Button variant="ghost" size="icon-sm" aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}>
            <ChevronLeftIcon aria-hidden="true" />
          </Button>
          <PageInput page={page} total={total} onPage={onPage} />
          <Button variant="ghost" size="icon-sm" aria-label="Next page" disabled={page >= total} onClick={() => onPage(page + 1)}>
            <ChevronRightIcon aria-hidden="true" />
          </Button>
          <span className="mx-2 h-4 w-px bg-border" aria-hidden="true" />
          <Button variant="ghost" size="icon-sm" aria-label="Zoom out" disabled={zoom !== "fit" && zoom <= zooms[0]!} onClick={() => step(-1)}>
            <ZoomOutIcon aria-hidden="true" />
          </Button>
          <span className="w-12 text-center font-mono text-xs tabular-nums" aria-live="polite">
            {zoom === "fit" ? "Fit" : `${Math.round(zoom * 100)}%`}
          </span>
          <Button variant="ghost" size="icon-sm" aria-label="Zoom in" disabled={zoom !== "fit" && zoom >= zooms[zooms.length - 1]!} onClick={() => step(1)}>
            <ZoomInIcon aria-hidden="true" />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Fit the page to the width" aria-pressed={zoom === "fit"} onClick={() => setZoom("fit")}>
            <MaximizeIcon aria-hidden="true" />
          </Button>
          {source.ocrPages.includes(page) && <OcrBadge className="ml-2" />}
          <a href={`${sourceBlobUrl(source.id)}#page=${page}`} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:underline">
            <ExternalLinkIcon aria-hidden="true" className="size-3" /> Open this page in the PDF
          </a>
        </div>
        <div className="flex min-h-0 flex-1 flex-col xl:flex-row">
          <div className="relative min-h-0 min-w-0 flex-1 overflow-auto bg-muted/30 p-4 md:p-6">
            <div className="relative mx-auto bg-white shadow-md" style={{ width: zoom === "fit" ? "min(100%, 60rem)" : `${zoom * 100}%` }}>
              {loaded !== page && <Skeleton className="absolute inset-0 aspect-[1/1.41] w-full" />}
              <img key={page} src={sourcePageUrl(source.id, page)} alt={`Page ${page} of ${source.title}`} className={cn("block w-full", loaded !== page && "invisible")} onLoad={() => setLoaded(page)} />
            </div>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
