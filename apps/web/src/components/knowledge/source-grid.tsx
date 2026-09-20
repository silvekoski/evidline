import type { ReactNode } from "react";
import { Link } from "react-router";
import { cn } from "cn";
import type { Source } from "@tpm/schemas";
import { sourcePageUrl } from "@/api";
import { formatBytes, formatTime } from "@/lib/format";
import { sourceIcon, sourceKindWord } from "./badges";
import { SourceMenu } from "./source-menu";
import { SourceStatusText, needsAttention } from "./source-status";

const csvRow = (text: string) => text.split(";").map((cell) => cell.split(":").slice(1).join(":").trim());
const csvHead = (text: string) => text.split(";").map((cell) => cell.split(":")[0]!.trim());

// The excerpt can cut a table row short before its closing "|". Match the leading "|" only.
const isTableLine = (line: string) => /^\s*\|/.test(line);
const isSeparatorLine = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line);
const isListLine = (line: string) => /^\s*[-*+]\s+\S/.test(line);
const tableCells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());

function TextRow({ text, clamp, bold }: { text: string; clamp: boolean; bold: boolean }) {
  const lines = text.split("\n");
  if (lines.length > 1 && lines.every(isTableLine)) {
    const [head, ...body] = lines.filter((line) => !isSeparatorLine(line)).map(tableCells);
    if (!head) return null;
    return (
      <table className="w-full border-collapse">
        <thead>
          <tr>
            {head.map((cell, i) => (
              <th key={i} className="border-b border-neutral-300 pr-1.5 pb-0.5 text-left font-medium whitespace-nowrap">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((cells, i) => (
            <tr key={i}>
              {cells.map((cell, j) => (
                <td key={j} className="max-w-16 truncate border-b border-neutral-100 pr-1.5 py-0.5">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  if (lines.length > 1 && lines.every(isListLine)) {
    return (
      <ul className="list-disc pl-3">
        {lines.map((line, i) => (
          <li key={i} className="truncate">
            {line.replace(/^\s*[-*+]\s+/, "")}
          </li>
        ))}
      </ul>
    );
  }
  return <p className={cn("whitespace-pre-line", clamp && "line-clamp-3", bold && "text-[8px] font-medium")}>{text}</p>;
}

function Paper({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div aria-hidden="true" className={cn("absolute inset-x-3 top-3 bottom-0 overflow-hidden rounded-t-sm bg-white px-2.5 pt-2.5 text-[7px] leading-[10px] text-neutral-800 shadow-sm", className)}>
      {children}
    </div>
  );
}

function Excerpt({ source }: { source: Source }) {
  const rows = source.excerpt;
  if (source.mediaType === "text/csv" && rows.every((r) => r.text.includes(":"))) {
    const head = csvHead(rows[0]!.text).slice(0, 5);
    return (
      <Paper className="font-mono">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {head.map((h) => (
                <th key={h} className="border-b border-neutral-300 pr-1.5 pb-0.5 text-left font-medium whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {csvRow(r.text)
                  .slice(0, 5)
                  .map((cell, j) => (
                    <td key={j} className="max-w-16 truncate border-b border-neutral-100 pr-1.5 py-0.5">
                      {cell}
                    </td>
                  ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Paper>
    );
  }
  if (rows.some((r) => r.speaker)) {
    return (
      <Paper>
        <dl className="flex flex-col gap-1">
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[minmax(0,5em)_1fr] gap-x-1.5">
              <dt className="truncate font-medium">{r.speaker}</dt>
              <dd className={cn(rows.length > 1 && "line-clamp-2")}>{r.text}</dd>
            </div>
          ))}
        </dl>
      </Paper>
    );
  }
  return (
    <Paper>
      <div className="flex flex-col gap-1">
        {rows.map((r, i) => (
          <TextRow key={i} text={r.text} clamp={rows.length > 1} bold={i === 0} />
        ))}
      </div>
    </Paper>
  );
}

function Preview({ source }: { source: Source }) {
  const Icon = sourceIcon(source);
  const paged = source.mediaType === "application/pdf" && source.status === "processed" && (source.pages ?? 0) > 0;
  return (
    <div className="relative aspect-[16/10] overflow-hidden border-b bg-muted/40">
      {paged ? (
        <img src={sourcePageUrl(source.id, 1)} alt="" loading="lazy" className="size-full object-cover object-top" />
      ) : source.excerpt.length > 0 ? (
        <Excerpt source={source} />
      ) : source.error ? (
        <p className="flex size-full items-center p-3 text-xs text-muted-foreground" aria-hidden="true">
          <span className="line-clamp-4">{source.error}</span>
        </p>
      ) : (
        <div className="flex size-full items-center justify-center text-muted-foreground">
          <Icon aria-hidden="true" className="size-10" strokeWidth={1.25} />
        </div>
      )}
    </div>
  );
}

export function SourceGrid({ sources }: { sources: Source[] }) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6" aria-label="Sources">
      {sources.map((source) => {
        const Icon = sourceIcon(source);
        return (
          <li
            key={source.id}
            className={cn("group relative flex flex-col overflow-hidden rounded-lg border bg-card transition-colors hover:bg-muted/40 focus-within:border-ring", needsAttention(source.status) && "border-dashed")}
          >
            <Preview source={source} />
            <div className="flex items-start gap-2 p-2.5">
              <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <Link to={`/sources/${source.id}`} className="line-clamp-2 text-sm font-medium break-words outline-none after:absolute after:inset-0" title={source.title}>
                  {source.title}
                </Link>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  <span className="sr-only">{sourceKindWord(source.kind)}, </span>
                  <span className="whitespace-nowrap">{formatTime(source.occurredAt)}</span> · <span className="whitespace-nowrap">{formatBytes(source.bytes)}</span>
                  {source.claims > 0 && (
                    <>
                      {" · "}
                      <span className="whitespace-nowrap">{source.claims} claims</span>
                    </>
                  )}
                </p>
                {source.status !== "processed" && <SourceStatusText status={source.status} className="mt-1 text-xs" />}
              </div>
              <div className="relative z-10 -mt-1 -mr-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                <SourceMenu source={source} />
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
