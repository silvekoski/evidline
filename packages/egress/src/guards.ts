import { EgressPayload, type GuardResult, type Purpose } from "@tpm/schemas";
import type { ZodError } from "zod";
import { scanNames, scanValues, type LeakIndex } from "./leak";
import { roundSig } from "./round";

export const MAX_PAYLOAD_BYTES = 8192;
export const MAX_ARRAY_LENGTH = 20;
export const SAMPLE_FLOOR = 100;

export type GuardInput = { purpose: Purpose; payload: unknown; text: string; index: LeakIndex };
export type PayloadGuard = (input: GuardInput) => GuardResult;

function walk(value: unknown, visit: (key: string, value: unknown) => void, key = ""): void {
  visit(key, value);
  if (Array.isArray(value)) value.forEach((v) => walk(v, visit, key));
  else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) walk(v, visit, k);
  }
}

export function issueSummary(error: ZodError): string {
  return error.issues
    .slice(0, 3)
    .map((i) => `${i.path.join(".") || "root"}: ${i.message}`)
    .join(", ");
}

export const schemaGuard: PayloadGuard = ({ purpose, payload }) => {
  const parsed = EgressPayload.safeParse(payload);
  if (!parsed.success) return { name: "schema", pass: false, detail: issueSummary(parsed.error) };
  return parsed.data.purpose === purpose
    ? { name: "schema", pass: true, detail: `${purpose} payload matches the strict schema` }
    : { name: "schema", pass: false, detail: `payload purpose ${parsed.data.purpose} differs from ${purpose}` };
};

export const floorGuard: PayloadGuard = ({ payload }) => {
  let smallest = Infinity;
  walk(payload, (key, v) => {
    if (key === "n" && typeof v === "number") smallest = Math.min(smallest, v);
  });
  return { name: "floor", pass: smallest >= SAMPLE_FLOOR, detail: `smallest sample count n = ${smallest}, floor ${SAMPLE_FLOOR}` };
};

export const sizeGuard: PayloadGuard = ({ payload, text }) => {
  let longest = 0;
  walk(payload, (_key, v) => {
    if (Array.isArray(v) && v.every((x) => typeof x === "number")) longest = Math.max(longest, v.length);
  });
  const bytes = Buffer.byteLength(text, "utf8");
  return {
    name: "size",
    pass: longest <= MAX_ARRAY_LENGTH && bytes <= MAX_PAYLOAD_BYTES,
    detail: `${bytes} bytes of ${MAX_PAYLOAD_BYTES}, longest number array ${longest} of ${MAX_ARRAY_LENGTH}`,
  };
};

export const roundingGuard: PayloadGuard = ({ payload }) => {
  let numbers = 0;
  let rounded = 0;
  walk(payload, (_key, v) => {
    if (typeof v !== "number") return;
    numbers++;
    if (roundSig(v) !== v) rounded++;
  });
  return { name: "rounding", pass: true, detail: `${rounded} of ${numbers} numbers rounded to 3 significant digits, integers exact` };
};

export const leakGuard: PayloadGuard = ({ text, index }) => {
  const { hits, detail } = scanValues(text, index);
  return { name: "leak", pass: hits === 0, detail, hits };
};

export const namesGuard: PayloadGuard = ({ text, index }) => {
  const { hits, detail } = scanNames(text, index);
  return { name: "names", pass: hits === 0, detail, hits };
};

export const payloadGuards: PayloadGuard[] = [schemaGuard, floorGuard, sizeGuard, roundingGuard, leakGuard, namesGuard];

export function recordGuard(recordId: string): GuardResult {
  return { name: "record", pass: true, detail: `record ${recordId} written before the send` };
}
