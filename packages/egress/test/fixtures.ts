import type { EgressPayload, EgressRecord, ModelMode, SensorSummary, TraceStep } from "@tpm/schemas";
import { buildLeakIndex, createGateway, type EgressStore, type Gateway, type LeakIndex, type Provider } from "../src/index";

export const evidenceId = (k: number) => `ev-0123abcd-${String(k).padStart(5, "0")}`;

export const sensorSummary: SensorSummary = {
  alias: "S01",
  n: 500,
  signalType: "slow",
  missingRate: 0.01,
  quantiles: { p1: 0.5, p5: 0.6, p25: 0.8, p50: 1, p75: 1.2, p95: 1.4, p99: 1.5 },
  mad: 0.2,
  histogramShares: Array.from({ length: 20 }, () => 0.05),
  noise: 0.01,
  acfTime: 30,
  period: null,
  flatShare: 0,
  monotonicShare: 0.1,
  distinct: 400,
  hold: 1,
  role: "controlled",
  roleConfidence: 0.7,
  leads: [{ alias: "S02", lag: 3, rho: 0.8, n: 500 }],
  follows: [],
};

export const nameRolePayload: EgressPayload = { purpose: "name_role", dt: 180000, sensor: sensorSummary };

export const compileRulePayload = (sentence: string, dt: number | null = 180000): EgressPayload => ({
  purpose: "compile_rule",
  sentence,
  dt,
  n: 20000,
  catalog: [
    { alias: "S03", signalType: "slow", role: "controlled" },
    { alias: "S04", signalType: "slow", role: "setpoint" },
    { alias: "S07", signalType: "fast", role: "actuator" },
  ],
});

export const healthStep: TraceStep = {
  index: 0,
  test: "health",
  name: "Health gate",
  n: 8000,
  stats: { runLength: 6400, threshold: 40 },
  result: "S05 failed the dead check with a run of 6400 identical samples against a limit of 40.",
  evidenceIds: [evidenceId(1)],
};

export const explainPayload: EgressPayload = {
  purpose: "explain_diagnosis",
  faultClass: "sensor-dead",
  n: 8000,
  onset: 12000,
  ranked: [{ alias: "S05", contribution: 1 }],
  excluded: ["S05"],
  trace: [
    healthStep,
    {
      index: 1,
      test: "verdict",
      name: "Verdict",
      n: 8000,
      stats: { contribution: 1 },
      result: "S05 is excluded from the process diagnosis.",
      evidenceIds: [evidenceId(1), evidenceId(2)],
    },
  ],
};

export const planPayload = (stage: string, question = "Is this right?", sensor: string | null = "S03"): EgressPayload => ({
  purpose: "plan_investigation",
  question,
  dt: 180000,
  n: 20000,
  inference: {
    stage,
    claim: "S03 drifts from sample 12000",
    sensor,
    onset: 12000,
    baseline: { from: 0, to: 9000 },
    masked: [{ from: 15000, to: 20000 }],
  },
  catalog: [
    { alias: "S03", signalType: "slow", role: "controlled" },
    { alias: "S04", signalType: "slow", role: "setpoint" },
  ],
  tools: ["compare_windows", "test_relation", "find_changepoints", "rerun_without", "test_role", "check_rule"],
});

export function memoryStore(): EgressStore & { records: EgressRecord[] } {
  const records: EgressRecord[] = [];
  return {
    records,
    write: (r) => void records.push(r),
    update(id, patch) {
      const i = records.findIndex((r) => r.id === id);
      if (i < 0) throw new Error(`no record ${id}`);
      records[i] = { ...(records[i] as EgressRecord), ...patch };
    },
  };
}

export function capturingProvider(reply: (purpose: string) => string): Provider & { calls: { payloadText: string; template: string }[] } {
  const calls: { payloadText: string; template: string }[] = [];
  return {
    name: "mock",
    model: "mock-1",
    region: null,
    host: "http://mock.local",
    calls,
    async call(payloadText, template) {
      calls.push({ payloadText, template });
      const purpose = (JSON.parse(payloadText) as { purpose: string }).purpose;
      return reply(purpose);
    },
  };
}

export const replies: Record<string, string> = {
  name_role: JSON.stringify({ name: "temperature", quantity: "degrees", confidence: 0.6, reason: "slow and smooth" }),
  compile_rule: JSON.stringify({ rule: { type: "range", sensor: "S03", source: "S03 must stay below 20", max: 20 } }),
  explain_diagnosis: JSON.stringify({ sentences: [{ text: "Sensor fault: dead.", evidenceIds: [evidenceId(1)] }] }),
  plan_investigation: JSON.stringify({ calls: [{ tool: "rerun_without", sensor: "S03" }], rationale: "mask the suspect" }),
};

export function testGateway(opts: { mode: ModelMode; provider?: Provider | null; index?: LeakIndex }): {
  gateway: Gateway;
  store: EgressStore & { records: EgressRecord[] };
} {
  const store = memoryStore();
  let counter = 0;
  const gateway = createGateway({
    store,
    getSettings: () => ({ mode: opts.mode, provider: null }),
    getProvider: () => opts.provider ?? null,
    leakIndex: () => opts.index ?? buildLeakIndex([], []),
    nowIso: () => "2026-09-19T12:00:00Z",
    newId: () => `eg-${String(++counter).padStart(3, "0")}`,
  });
  return { gateway, store };
}
