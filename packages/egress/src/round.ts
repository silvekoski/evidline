export function roundSig(x: number, digits = 3): number {
  return Number.isInteger(x) || !Number.isFinite(x) ? x : Number(x.toPrecision(digits));
}

export function roundPayload(value: unknown): unknown {
  if (typeof value === "number") return roundSig(value);
  if (Array.isArray(value)) return value.map(roundPayload);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, roundPayload(v)]));
  }
  return value;
}
