export const plainDecimal = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

export function parseNumber(text: string): number {
  const compact = text.replace(/[\s']/g, "");
  if (compact === "") return NaN;
  const lastComma = compact.lastIndexOf(",");
  const lastDot = compact.lastIndexOf(".");
  let normalized: string;
  if (lastComma < 0) normalized = lastDot === compact.indexOf(".") ? compact : compact.replace(/\./g, "");
  else if (lastDot > lastComma || compact.indexOf(",") !== lastComma) normalized = compact.replace(/,/g, "");
  else normalized = compact.replace(/\./g, "").replace(",", ".");
  return plainDecimal.test(normalized) ? Number(normalized) : NaN;
}
