import {
  faultLabel,
  type CompileRuleResponse,
  type EgressPayload,
  type ExplainDiagnosisResponse,
  type PlanInvestigationResponse,
  type Purpose,
  type RuleJson,
  type ToolCall,
} from "@tpm/schemas";

type PayloadOf<P extends Purpose> = Extract<EgressPayload, { purpose: P }>;
type Agg = Extract<RuleJson, { type: "aggregate" }>["agg"];

const unitMs: Record<string, number> = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };

function samplesPerUnit(unit: string, dt: number | null): number | null {
  const key = unit.charAt(0).toLowerCase();
  if (key === "s") return 1;
  return dt === null ? null : (unitMs[key] ?? 0) / dt;
}

function toSamples(value: number, unit: string, dt: number | null): number | null {
  const per = samplesPerUnit(unit, dt);
  return per === null ? null : Math.max(1, Math.ceil(value * per));
}

export const ruleSentenceForms = [
  "S07 must not stay flat for more than 10 minutes",
  "S03 must stay between 10 and 20",
  "S03 must stay below 20",
  "S03 must stay above 10",
  "S03 must not change faster than 5 per sample",
  "S03 must track S04 within 2",
  "S03 must not be missing more than 5% in 1 hour",
  "mean of S03 over 1 hour must stay below 20",
];

const alias = String.raw`(S\d{2,4})`;
const num = String.raw`(-?\d+(?:\.\d+)?)`;
const dur = String.raw`(\d+(?:\.\d+)?)\s*(samples?|minutes?|min|hours?|h|days?|d)`;
const bound = `(?:between ${num} and ${num}|below ${num}|above ${num})`;
const form = (body: string) => new RegExp(`^${body}\\.?$`, "i");

const flatline = form(`${alias} must not stay flat for more than ${dur}`);
const range = form(`${alias} must stay ${bound}`);
const rate = form(`${alias} must not change faster than ${num} per (sample|minute|hour|day)`);
const relation = form(`${alias} must (track|equal) ${alias} within ${num}`);
const missing = form(`${alias} must not be missing more than ${num}\\s*% in ${dur}`);
const aggregate = form(`(mean|median|min|max|std) of ${alias} over ${dur} must stay ${bound}`);

function bounds(groups: (string | undefined)[]): { min?: number; max?: number } | null {
  const [lo, hi, below, above] = groups;
  if (lo !== undefined && hi !== undefined) return { min: Number(lo), max: Number(hi) };
  if (below !== undefined) return { max: Number(below) };
  if (above !== undefined) return { min: Number(above) };
  return null;
}

function parseRule(sentence: string, dt: number | null): RuleJson | null {
  const source = sentence.trim();
  const base = (m: RegExpMatchArray, group = 1) => ({ sensor: (m[group] as string).toUpperCase(), source });
  let m = source.match(flatline);
  if (m) {
    const maxDuration = toSamples(Number(m[2]), m[3] as string, dt);
    return maxDuration === null ? null : { type: "flatline", ...base(m), maxDuration };
  }
  m = source.match(range);
  if (m) {
    const b = bounds(m.slice(2, 6));
    return b === null ? null : { type: "range", ...base(m), ...b };
  }
  m = source.match(rate);
  if (m) {
    const per = samplesPerUnit(m[3] as string, dt);
    return per === null ? null : { type: "rate", ...base(m), maxRate: Number(m[2]) / per };
  }
  m = source.match(relation);
  if (m) {
    const kind = (m[2] as string).toLowerCase() === "track" ? "tracks" : "equals";
    return { type: "relation", ...base(m), sensor2: (m[3] as string).toUpperCase(), relation: kind, tolerance: Number(m[4]) };
  }
  m = source.match(missing);
  if (m) {
    const windowSize = toSamples(Number(m[3]), m[4] as string, dt);
    return windowSize === null ? null : { type: "missing", ...base(m), maxMissingRate: Number(m[2]) / 100, windowSize };
  }
  m = source.match(aggregate);
  if (m) {
    const windowSize = toSamples(Number(m[3]), m[4] as string, dt);
    const b = bounds(m.slice(5, 9));
    if (windowSize === null || b === null) return null;
    return { type: "aggregate", ...base(m, 2), agg: (m[1] as string).toLowerCase() as Agg, windowSize, ...b };
  }
  return null;
}

function explain(p: PayloadOf<"explain_diagnosis">): ExplainDiagnosisResponse | null {
  const verdict = p.trace.find((s) => s.test === "verdict") ?? p.trace[p.trace.length - 1];
  if (!verdict) return null;
  const label = faultLabel(p.faultClass);
  const steps = p.trace.map((s) => ({ text: s.result, evidenceIds: s.evidenceIds }));
  return { sentences: steps.some((s) => s.text.includes(label)) ? steps : [{ text: `${label}.`, evidenceIds: verdict.evidenceIds }, ...steps] };
}

function questionCenter(question: string, dt: number | null): number | null {
  const m = question.match(/(\d+(?:\.\d+)?)\s*(samples?|days?|weeks?)\b/i);
  if (m) return toSamples(Number(m[1]), m[2] as string, dt);
  const w = question.match(/\b(sample|day|week)\s+(\d+(?:\.\d+)?)/i);
  return w ? toSamples(Number(w[2]), w[1] as string, dt) : null;
}

function plan(p: PayloadOf<"plan_investigation">): PlanInvestigationResponse | null {
  const { stage, sensor, onset, responsible, baseline, masked } = p.inference;
  const span = Math.max(1, Math.round(0.02 * p.n));
  const center = questionCenter(p.question, p.dt);
  const rest = { from: baseline.to, to: p.n };
  const calls: ToolCall[] = [];
  if (stage === "role" && sensor) {
    const role = p.catalog.find((c) => c.alias === sensor)?.role ?? "unknown";
    calls.push({ tool: "test_role", sensor, role }, { tool: "compare_windows", sensor, a: baseline, b: rest });
  } else if (stage === "drift" && sensor) {
    calls.push({ tool: "find_changepoints", sensor, near: center ?? onset ?? baseline.to, span });
    if (responsible !== null) calls.push({ tool: "rerun_without", sensor: responsible });
  } else if (stage === "diagnosis" && sensor) {
    const incident = { from: onset ?? masked[0]?.from ?? baseline.to, to: p.n };
    calls.push({ tool: "rerun_without", sensor }, { tool: "compare_windows", sensor, a: baseline, b: incident });
  } else if (stage === "health" && sensor) {
    calls.push({ tool: "compare_windows", sensor, a: baseline, b: masked[0] ?? rest });
  } else if (stage === "baseline") {
    const target = sensor ?? p.catalog[0]?.alias;
    if (target) calls.push({ tool: "find_changepoints", sensor: target, near: center ?? baseline.to, span });
  }
  if (calls.length === 0) return null;
  return { calls, rationale: `Model off. Fixed plan for a ${stage} inference: ${calls.map((c) => c.tool).join(", ")}.` };
}

export const fallbackMissingReason: Record<Purpose, string> = {
  name_role: "no fallback for name_role, model off",
  check_name: "no fallback for check_name, model off",
  compile_rule: "sentence not understood, model off",
  explain_diagnosis: "trace has no steps, model off",
  plan_investigation: "no fixed plan for this stage, model off",
  search: "no fallback for search, model off",
  cross_review: "no fallback for cross_review, model off",
};

export function fallback(purpose: Purpose, payload: EgressPayload): unknown | null {
  if (payload.purpose !== purpose) return null;
  switch (payload.purpose) {
    case "name_role":
    case "check_name":
      return null;
    case "compile_rule": {
      const rule = parseRule(payload.sentence, payload.dt);
      return rule === null ? null : ({ rule } satisfies CompileRuleResponse);
    }
    case "explain_diagnosis":
      return explain(payload);
    case "plan_investigation":
      return plan(payload);
    case "search":
    case "cross_review":
      return null;
  }
}
