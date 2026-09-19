export const numberToken = /(?<![\w-])-?\d+(?:\.\d+)?(?:e[+-]?\d+)?(?!\w)/gi;
export const aliasToken = /\bS\d{2,4}\b/g;
export const evidenceIdToken = /\bev-[0-9a-f]{8}-\d{5}\b/g;

export const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function significantDigits(token: string): number {
  const mantissa = token.toLowerCase().split("e")[0] ?? "";
  const digits = mantissa.replace(/[^0-9.]/g, "");
  const stripped = digits.includes(".") ? digits.replace(".", "").replace(/^0+/, "") : digits.replace(/^0+/, "").replace(/0+$/, "");
  return Math.min(3, Math.max(1, stripped.length));
}
