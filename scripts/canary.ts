import { createMemorySink, gaussian, mulberry32, runPipeline, window, type Grid } from "@tpm/core";
import { buildLeakIndex, createGateway, roundSig, type EgressStore, type Provider } from "@tpm/egress";
import type { EgressPayload, EgressRecord, Purpose, SensorSummary } from "@tpm/schemas";

const SENSORS = 8;
const N = 20_000;
const RUN_ID = "0badcafe";
const RUN_NAME = "canary-plant-run.csv";
const SOURCE_NAMES = Array.from({ length: SENSORS }, (_, i) => `reactor_probe_${i + 1}`);
const ISO_DATE = /\d{4}-\d{2}-\d{2}/;

const failures: string[] = [];
const check = (ok: boolean, message: string): void => {
  if (!ok) failures.push(message);
  console.log(`${ok ? "ok  " : "FAIL"} ${message}`);
};

function makeGrid(): Grid {
  const rng = mulberry32(99);
  const values = Array.from({ length: SENSORS }, (_, i) => {
    const x = new Float64Array(N);
    x[0] = 100 * (i + 1);
    for (let t = 1; t < N; t++) x[t] = 0.98 * x[t - 1]! + 2 * (i + 1) + gaussian(rng) + 1e-4 * (t % 997);
    return x;
  });
  return {
    aliases: values.map((_, i) => `S${String(i + 1).padStart(2, "0")}`),
    values,
    n: N,
    dt: 180_000,
    time: Float64Array.from({ length: N }, (_, t) => Date.parse("2026-01-01T00:00:00Z") + t * 180_000),
    episodes: [window(0, N)],
  };
}

function memoryStore(): EgressStore & { records: EgressRecord[] } {
  const records: EgressRecord[] = [];
  return {
    records,
    write: (r) => void records.push(r),
    update(id, patch) {
      const i = records.findIndex((r) => r.id === id);
      if (i < 0) throw new Error(`no record ${id}`);
      records[i] = { ...records[i]!, ...patch };
    },
  };
}

const replies: Record<Purpose, string> = {
  name_role: JSON.stringify({ name: "pressure", quantity: "kPa", confidence: 0.5, reason: "slow and smooth" }),
  compile_rule: JSON.stringify({ rule: { type: "range", sensor: "S01", source: "S01 must stay below 20", max: 20 } }),
  explain_diagnosis: JSON.stringify({ sentences: [{ text: "Sensor fault: dead.", evidenceIds: ["ev-0badcafe-00001"] }] }),
  plan_investigation: JSON.stringify({ calls: [{ tool: "rerun_without", sensor: "S01" }], rationale: "mask the suspect" }),
};

const grid = makeGrid();
const sink = createMemorySink(RUN_ID);
const result = runPipeline(grid, sink);
const raw = grid.aliases.map((alias, i) => ({ alias, values: grid.values[i]! }));
const forbidden = [...SOURCE_NAMES, RUN_NAME, RUN_NAME.replace(/\.csv$/, "")];
const index = buildLeakIndex(raw, forbidden);
const captured: string[] = [];
const provider: Provider = {
  name: "capture",
  model: "capture-1",
  region: null,
  host: "http://capture.local",
  async call(payloadText) {
    captured.push(payloadText);
    return replies[(JSON.parse(payloadText) as { purpose: Purpose }).purpose];
  },
};
const store = memoryStore();
let counter = 0;
const gateway = createGateway({
  store,
  getSettings: () => ({ mode: "cloud", provider: null }),
  getProvider: () => provider,
  leakIndex: () => index,
  nowIso: () => new Date().toISOString(),
  newId: () => `eg-${RUN_ID}-${String(++counter).padStart(5, "0")}`,
});
const ctx = { runId: RUN_ID, inferenceId: null, operatorText: false };

function summary(i: number): SensorSummary {
  const fp = result.fingerprints[i]!;
  const role = result.roles[i]!;
  const peers = (result.graph.peers.get(grid.aliases[i]!) ?? []).map((p) => ({ alias: p.alias, lag: p.lag, rho: p.rho, n: p.n }));
  return {
    alias: grid.aliases[i]!,
    n: fp.n,
    signalType: fp.signalType,
    missingRate: fp.missingRate,
    quantiles: fp.quantiles,
    mad: fp.mad,
    histogramShares: fp.histogram.shares,
    noise: fp.noise,
    acfTime: fp.acfTime,
    period: fp.period,
    flatShare: fp.flatShare,
    monotonicShare: fp.monotonicShare,
    distinct: fp.distinct,
    hold: fp.hold,
    role: role.value.role,
    roleConfidence: role.confidence,
    leads: peers.filter((p) => p.lag < 0).slice(0, 20),
    follows: peers.filter((p) => p.lag > 0).slice(0, 20),
  };
}

const catalog = grid.aliases.map((alias, i) => ({ alias, signalType: result.fingerprints[i]!.signalType, role: result.roles[i]!.value.role }));
const incident = result.incidents[0];
const explain: EgressPayload = incident
  ? {
      purpose: "explain_diagnosis",
      faultClass: incident.value.faultClass,
      n: incident.value.window.n,
      onset: incident.value.onset,
      ranked: incident.value.ranked.slice(0, 20).map((r) => ({ alias: r.sensor, contribution: r.contribution })),
      excluded: incident.value.excluded.slice(0, 20),
      trace: incident.value.trace,
    }
  : {
      purpose: "explain_diagnosis",
      faultClass: "process-degradation",
      n: N,
      onset: null,
      ranked: [{ alias: "S01", contribution: 1 }],
      excluded: [],
      trace: [{ index: 0, test: "verdict", name: "Verdict", n: N, stats: { maxDeviation: result.drifts[0]!.value.maxDeviation }, result: "No incident.", evidenceIds: [result.drifts[0]!.evidenceIds[0]!] }],
    };
const payloads: EgressPayload[] = [
  ...grid.aliases.map((_, i): EgressPayload => ({ purpose: "name_role", dt: grid.dt, sensor: summary(i) })),
  { purpose: "compile_rule", sentence: "S01 must stay below 20", dt: grid.dt, n: N, catalog },
  explain,
  {
    purpose: "plan_investigation",
    question: "Is S01 drifting?",
    dt: grid.dt,
    n: N,
    inference: { stage: "drift", claim: result.drifts[0]!.claim.slice(0, 300), sensor: "S01", onset: result.drifts[0]!.value.onset, baseline: { from: 0, to: result.baseline.value.window.to }, masked: [] },
    catalog,
    tools: ["compare_windows", "test_relation", "find_changepoints", "rerun_without", "test_role", "check_rule"],
  },
];

for (const payload of payloads) {
  const outcome = await gateway.call(payload.purpose, payload, ctx);
  check(outcome.ok, `${payload.purpose} call ok${outcome.ok ? "" : `: ${outcome.reason}`}`);
}
check(store.records.length === payloads.length, `${store.records.length} records for ${payloads.length} calls`);
check(store.records.every((r) => r.status === "sent"), "every record has status sent");
check(store.records.every((r) => r.guards.every((g) => g.pass)), "every guard passed");
const hits = store.records.reduce((s, r) => s + r.guards.reduce((h, g) => h + (g.hits ?? 0), 0), 0);
check(hits === 0, `scanner hits: ${hits}`);
check(captured.length === payloads.length && captured.every((text, i) => text === store.records[i]!.payload), "the provider received the recorded payload bytes");

const rounded = raw.map((r) => Array.from(r.values, (v) => roundSig(v)));
const triples = new Set<string>();
for (const series of rounded) for (let t = 2; t < series.length; t++) triples.add(`${series[t - 2]},${series[t - 1]},${series[t]}`);
const numberToken = /-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi;
let tripleHits = 0;
let nameHits = 0;
let dateHits = 0;
for (const text of captured) {
  const numbers = (text.match(numberToken) ?? []).map(Number);
  for (let i = 2; i < numbers.length; i++) if (triples.has(`${numbers[i - 2]},${numbers[i - 1]},${numbers[i]}`)) tripleHits++;
  const lower = text.toLowerCase();
  for (const name of forbidden) if (lower.includes(name.toLowerCase())) nameHits++;
  if (ISO_DATE.test(text)) dateHits++;
}
check(tripleHits === 0, `runs of 3 consecutive rounded raw samples in payloads: ${tripleHits}`);
check(nameHits === 0, `source names, file stem or run name in payloads: ${nameHits}`);
check(dateHits === 0, `ISO dates in payloads: ${dateHits}`);

const planted = payloads[0]!;
const plantedTriple = rounded[0]!.slice(1000, 1003);
const withTriple = { ...planted, sensor: { ...(planted as { sensor: SensorSummary }).sensor, histogramShares: [...plantedTriple, ...Array(17).fill(0.01)] } } as EgressPayload;
const tripleOutcome = await gateway.call("name_role", withTriple, ctx);
check(!tripleOutcome.ok && store.records.at(-1)!.status === "blocked", `a planted raw triple is blocked${tripleOutcome.ok ? "" : `: ${tripleOutcome.reason}`}`);
const withName = { ...payloads[payloads.length - 3], sentence: `${SOURCE_NAMES[2]} must stay below 20` } as EgressPayload;
const nameOutcome = await gateway.call("compile_rule", withName, ctx);
check(!nameOutcome.ok && store.records.at(-1)!.status === "blocked", `a planted source name is blocked${nameOutcome.ok ? "" : `: ${nameOutcome.reason}`}`);

if (failures.length > 0) {
  console.error(`canary failed: ${failures.length} check${failures.length === 1 ? "" : "s"}`);
  process.exit(1);
}
console.log(`canary passed: ${payloads.length} calls, ${store.records.length} records, 0 scanner hits`);
