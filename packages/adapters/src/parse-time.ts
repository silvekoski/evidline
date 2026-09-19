import { parseNumber } from "./parse-number";

export type TimeUnit = "iso" | "s" | "ms";

const isoLike = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2}(?:[.,]\d{1,9})?)?)(Z|[+-]\d{2}:?\d{2})?)?$/;

export function parseTime(text: string, unit: TimeUnit): number {
  if (unit !== "iso") return parseNumber(text) * (unit === "s" ? 1000 : 1);
  const match = isoLike.exec(text.trim());
  if (match === null) return NaN;
  const [, date = "", clock, zone = "Z"] = match;
  return clock === undefined ? Date.parse(date) : Date.parse(`${date}T${clock.replace(",", ".")}${zone}`);
}
