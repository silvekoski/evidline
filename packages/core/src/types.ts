import type { Evidence, Window } from "@tpm/schemas";

export type Grid = {
  aliases: string[];
  values: Float64Array[];
  n: number;
  dt: number | null;
  time: Float64Array | null;
  episodes: Window[];
  siblings?: string[][];
};

export type Masks = Uint8Array[];

export type EvidenceInput = Omit<Evidence, "id" | "runId">;

export type EvidenceSink = {
  add(e: EvidenceInput, derived?: Record<string, Float64Array>): string;
};

export type MemorySink = EvidenceSink & {
  runId: string;
  evidence: Evidence[];
  derived: Map<string, Record<string, Float64Array>>;
};

export function createMemorySink(runId: string): MemorySink {
  const evidence: Evidence[] = [];
  const derived = new Map<string, Record<string, Float64Array>>();
  return {
    runId,
    evidence,
    derived,
    add(e, d) {
      const id = `ev-${runId}-${String(evidence.length + 1).padStart(5, "0")}`;
      evidence.push({ ...e, id, runId });
      if (d) derived.set(id, d);
      return id;
    },
  };
}

export function window(from: number, to: number): Window {
  return { from, to, n: to - from };
}
