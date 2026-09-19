import type { TraceStep, TraceTest } from "@tpm/schemas";
import { roundSig } from "./stats";

export const TRACE_TESTS: TraceTest[] = ["health", "drift", "isolation", "propagation", "control-loop", "verdict"];

export type Cited = { id: string; stats: Record<string, number> };

export type StepSpec = { name: string; n: number; cited: Cited[]; keys: string[]; result: string };

const MAX_RESULT = 300;

export function sig(x: number): string {
  return Number.isInteger(x) ? String(x) : String(roundSig(x));
}

export function listing(items: string[], max = 10): string {
  return items.length > max ? `${items.slice(0, max).join(", ")} and ${items.length - max} more` : items.join(", ");
}

export function buildTrace(steps: Record<TraceTest, StepSpec>): TraceStep[] {
  return TRACE_TESTS.map((test, index) => {
    const step = steps[test];
    const stats: Record<string, number> = {};
    for (const key of step.keys) {
      const source = step.cited.find((c) => Number.isFinite(c.stats[key]));
      if (source && Object.keys(stats).length < 20) stats[key] = source.stats[key]!;
    }
    const evidenceIds = [...new Set(step.cited.map((c) => c.id))].slice(0, 20);
    if (evidenceIds.length === 0) throw new Error(`trace step ${test} cites no evidence`);
    let result = step.result;
    if (result.length > MAX_RESULT) {
      const cut = result.lastIndexOf(" ", MAX_RESULT - 4);
      result = `${result.slice(0, cut > 0 ? cut : MAX_RESULT - 4)}...`;
    }
    return { index, test, name: step.name.slice(0, 60), n: step.n, stats, result, evidenceIds };
  });
}
