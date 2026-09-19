import { roundSig } from "./round";
import { escapeRegExp, numberToken } from "./tokens";

export type LeakIndex = { has(triple: [number, number, number]): boolean; names: string[]; size: number };

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);
const scratch = new Float64Array(3);

function mix(h: number, w: number, m: number, shift: number): number {
  const x = Math.imul(h ^ w, m);
  return x ^ (x >>> shift);
}

function hashRun(rounded: Float64Array, end: number): number {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = end - 2; i <= end; i++) {
    f64[0] = (rounded[i] as number) + 0;
    const lo = u32[0] as number;
    const hi = u32[1] as number;
    h1 = mix(mix(h1, lo, 0x85ebca6b, 13), hi, 0x85ebca6b, 13);
    h2 = mix(mix(h2, lo, 0xc2b2ae35, 16), hi, 0xc2b2ae35, 16);
  }
  return (h1 >>> 0) * 0x100000 + (h2 >>> 12);
}

export function buildLeakIndex(raw: { alias: string; values: Float64Array }[], forbidden: string[]): LeakIndex {
  const total = raw.reduce((sum, r) => sum + Math.max(0, r.values.length - 2), 0);
  const hashes = new Float64Array(total);
  let count = 0;
  for (const { values } of raw) {
    const rounded = values.map((v) => roundSig(v));
    for (let i = 2; i < rounded.length; i++) {
      if (Number.isNaN(rounded[i - 2]) || Number.isNaN(rounded[i - 1]) || Number.isNaN(rounded[i])) continue;
      hashes[count++] = hashRun(rounded, i);
    }
  }
  const sorted = hashes.subarray(0, count).sort();
  let size = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (i === 0 || sorted[i] !== sorted[i - 1]) sorted[size++] = sorted[i] as number;
  }
  const keys = sorted.slice(0, size);
  return {
    names: [...new Set(forbidden.filter((s) => s.length >= 3))],
    size,
    has(triple) {
      scratch.set(triple.map((v) => roundSig(v)));
      const key = hashRun(scratch, 2);
      let lo = 0;
      let hi = keys.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >>> 1;
        const v = keys[mid] as number;
        if (v === key) return true;
        if (v < key) lo = mid + 1;
        else hi = mid - 1;
      }
      return false;
    },
  };
}

export function scanValues(payloadText: string, index: LeakIndex): { hits: number; detail: string } {
  const tokens = [...payloadText.matchAll(numberToken)];
  const values = tokens.map((m) => Number(m[0]));
  const joined = tokens.map((m, i) => {
    const previous = tokens[i - 1];
    return previous !== undefined && !payloadText.slice(previous.index + previous[0].length, m.index).includes('"');
  });
  const found: string[] = [];
  for (let i = 2; i < values.length; i++) {
    const triple: [number, number, number] = [values[i - 2] as number, values[i - 1] as number, values[i] as number];
    const flat = triple[0] === triple[1] && triple[1] === triple[2];
    if (joined[i - 1] && joined[i] && !flat && index.has(triple)) found.push(triple.join(", "));
  }
  const detail =
    found.length === 0
      ? `${values.length} number tokens, no run of 3 raw samples`
      : `${found.length} runs of 3 raw samples, first: ${found[0]}`;
  return { hits: found.length, detail };
}

export function scanNames(payloadText: string, index: LeakIndex): { hits: number; detail: string } {
  const found: string[] = [];
  let hits = 0;
  for (const name of index.names) {
    const pattern = new RegExp(`(?<!\\w)${escapeRegExp(JSON.stringify(name).slice(1, -1))}(?!\\w)`, "gi");
    const count = payloadText.match(pattern)?.length ?? 0;
    if (count > 0) {
      hits += count;
      found.push(name);
    }
  }
  const detail =
    hits === 0
      ? `${index.names.length} forbidden names, none found`
      : `${hits} hits on ${found.length} forbidden names: ${found.slice(0, 5).join(", ")}`;
  return { hits, detail };
}

export function scanForLeaks(payloadText: string, index: LeakIndex): { valueHits: number; nameHits: number; detail: string } {
  const values = scanValues(payloadText, index);
  const names = scanNames(payloadText, index);
  return { valueHits: values.hits, nameHits: names.hits, detail: `${values.detail}. ${names.detail}.` };
}
