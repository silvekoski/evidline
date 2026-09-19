import type { Locator, SearchHit } from "@tpm/schemas";

export const formatClock = (ms: number): string => {
  const s = Math.floor(ms / 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return s >= 3600 ? `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}` : `${Math.floor(s / 60)}:${pad(s % 60)}`;
};

export function locatorLabel(locator: Locator): string {
  switch (locator.kind) {
    case "teams_call":
      return `${formatClock(locator.startMs)} to ${formatClock(locator.endMs)}${locator.speaker ? `, ${locator.speaker}` : ""}`;
    case "slack_thread":
      return `message ${locator.ts}`;
    case "email":
      return "email body";
    case "file":
      if (locator.page !== null) return `page ${locator.page}`;
      if (locator.sheet !== null) return `sheet ${locator.sheet}, row ${locator.row ?? 0}`;
      return `characters ${locator.charStart} to ${locator.charEnd}`;
    case "column":
      return `column ${locator.column}`;
  }
}

export const locatorQuery = (locator: Locator): string => {
  const params = new URLSearchParams();
  if (locator.kind === "teams_call") params.set("at", String(locator.startMs));
  if (locator.kind === "file" && locator.page !== null) params.set("page", String(locator.page));
  if (locator.kind === "file" && locator.row !== null) params.set("row", String(locator.row));
  if (locator.kind === "file" && locator.page === null && locator.row === null) params.set("char", String(locator.charStart));
  if (locator.kind === "email" || locator.kind === "slack_thread") params.set("char", "0");
  return params.toString();
};

export const sourceHref = (sourceId: number, locator: Locator, quote?: string): string => {
  const params = new URLSearchParams(locatorQuery(locator));
  if (quote) params.set("q", quote.slice(0, 200));
  return `/sources/${sourceId}?${params.toString()}`;
};

export const hitHref = (hit: SearchHit): string | null => (hit.sourceId === null ? null : sourceHref(hit.sourceId, hit.locator));
