import { createReadStream, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { loadSource } from "@tpm/adapters";
import {
  calibrateHealth,
  createMemorySink,
  defaultThresholds,
  fingerprint,
  fitPeerModel,
  healthGate,
  injectFault,
  mulberry32,
  quantiles,
  relationGraph,
  selectBaseline,
  window,
  type Grid,
  type Peer,
} from "@tpm/core";

const SAMPLE_MS = 180_000;
const T0 = Date.parse("2026-01-01T00:00:00Z");
const NORMAL_RUNS = 20;
const PROCESS_FAULT = 13;
const PROCESS_RUN = 1;
const FAULT_SAMPLE = 160;
const DEAD_AT = 0.6;
const RAMP_AT = 0.7;
const MIN_PEERS = 3;
const PEER_RHO = 0.5;
const MIN_SIGMA = 6;
const TARGET_SIGMA = 8;
const ROOM_SHARE = 0.85;
const SEED = 2026;

type Episode = { fault: number; run: number; rows: string[][] };

const [inputArg = "data/tep-subset.csv", outArg = "data/demo-stream.csv"] = process.argv.slice(2);
const input = resolve(inputArg);
const out = resolve(outArg);
const truthPath = out.replace(/\.csv$/, "") + ".truth.json";

function episodeKey(fault: number, run: number): string {
  return `${fault}:${run}`;
}

async function collectEpisodes(): Promise<{ sensors: string[]; episodes: Episode[] }> {
  const wanted = new Map<string, Episode>();
  for (let run = 1; run <= NORMAL_RUNS; run++) wanted.set(episodeKey(0, run), { fault: 0, run, rows: [] });
  wanted.set(episodeKey(PROCESS_FAULT, PROCESS_RUN), { fault: PROCESS_FAULT, run: PROCESS_RUN, rows: [] });
  const stream = createReadStream(input, { encoding: "utf8", highWaterMark: 1 << 20 });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  let header: string[] | null = null;
  let columns = { fault: -1, run: -1, sample: -1, source: -1, sensors: [] as number[] };
  let seen = 0;
  for await (const line of lines) {
    if (header === null) {
      header = line.split(",");
      columns = {
        fault: header.indexOf("faultNumber"),
        run: header.indexOf("simulationRun"),
        sample: header.indexOf("sample"),
        source: header.indexOf("source"),
        sensors: header.flatMap((name, i) => (/^(xmeas|xmv)_\d+$/.test(name) ? [i] : [])),
      };
      if (columns.fault < 0 || columns.run < 0 || columns.sample < 0 || columns.sensors.length === 0) {
        throw new Error(`${input} does not look like the TEP file: header ${header.slice(0, 5).join(",")}`);
      }
      continue;
    }
    if (line === "") continue;
    const cells = line.split(",");
    if (columns.source >= 0 && cells[columns.source] !== "test") continue;
    const episode = wanted.get(episodeKey(Number(cells[columns.fault]), Number(cells[columns.run])));
    if (!episode) continue;
    episode.rows.push([cells[columns.sample]!, ...columns.sensors.map((i) => cells[i]!)]);
    seen++;
    if (seen === wanted.size * 960 && [...wanted.values()].every((e) => e.rows.length === 960)) break;
  }
  lines.close();
  stream.destroy();
  const missing = [...wanted.values()].filter((e) => e.rows.length === 0);
  if (missing.length > 0) throw new Error(`episodes not found in ${input}: ${missing.map((e) => `fault ${e.fault} run ${e.run}`).join(", ")}`);
  return { sensors: columns.sensors.map((i) => header![i]!), episodes: [...wanted.values()] };
}

function writeStream(sensors: string[], rows: string[][]): void {
  const lines = [["time", "sample", ...sensors].join(",")];
  rows.forEach((row, t) => lines.push([new Date(T0 + t * SAMPLE_MS).toISOString(), ...row].join(",")));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, lines.join("\n") + "\n");
}

function format(v: number, like: string): string {
  const decimals = like.includes(".") ? like.length - like.indexOf(".") - 1 : 0;
  return Number.isFinite(v) ? v.toFixed(decimals) : "";
}

type Choice = { index: number; alias: string; sigma: number; magnitude: number; peers: Peer[]; p1: number; p99: number; lastMedian: number };

function analyze(grid: Grid): { rampFrom: number; deadFrom: number; ramp: Choice; dead: { index: number; alias: string; peers: Peer[] } } {
  const { n } = grid;
  const sink = createMemorySink("00000000");
  const fps = grid.values.map((x) => fingerprint(x, grid.episodes));
  const baseline = window(0, Math.min(selectBaseline(grid, fps, sink).value.window.to, Math.floor(DEAD_AT * n)));
  const thresholds = { ...defaultThresholds, ...calibrateHealth(grid, baseline, fps, sink, SEED).thresholds };
  const health = healthGate(grid, baseline, fps, thresholds, sink);
  const masks = health.map((h) => h.mask);
  const graph = relationGraph(grid, masks, health, baseline, fps, thresholds, sink);
  const rampFrom = Math.floor(RAMP_AT * n);
  const deadFrom = Math.floor(DEAD_AT * n);
  const block = grid.dt ? Math.round(86_400_000 / grid.dt) : Math.max(1, Math.floor(n / 200));
  const usable = (i: number) =>
    (fps[i]!.signalType === "slow" || fps[i]!.signalType === "fast") && health[i]!.value.masked.every((m) => m.from >= deadFrom);
  const strongPeers = (alias: string) => (graph.peers.get(alias) ?? []).filter((p) => Math.abs(p.rho) >= PEER_RHO);

  const choices: Choice[] = [];
  grid.aliases.forEach((alias, index) => {
    const peers = strongPeers(alias);
    if (!usable(index) || peers.length < MIN_PEERS) return;
    const x = grid.values[index]!;
    const { sigma } = fitPeerModel(grid, index, peers, baseline, masks);
    const q = quantiles(x.subarray(baseline.from, baseline.to));
    const tail = x.subarray(n - block, n);
    const lastMedian = quantiles(tail).p50;
    const up = q.p99 - lastMedian;
    const down = lastMedian - q.p1;
    const room = ROOM_SHARE * Math.max(up, down);
    if (room < MIN_SIGMA * sigma) return;
    const magnitude = Math.min(room, TARGET_SIGMA * sigma) * (up >= down ? 1 : -1);
    choices.push({ index, alias, sigma, magnitude, peers, p1: q.p1, p99: q.p99, lastMedian });
  });
  const ramp = choices.sort((a, b) => Math.abs(b.magnitude) / b.sigma - Math.abs(a.magnitude) / a.sigma || b.peers.length - a.peers.length)[0];
  if (!ramp) throw new Error("no sensor has 3 strong peers and room for a 6 sigma ramp inside its baseline p1..p99");

  const rampPeers = new Set(ramp.peers.map((p) => p.alias));
  const deadCandidates = grid.aliases
    .map((alias, index) => ({ alias, index, peers: strongPeers(alias) }))
    .filter((c) => usable(c.index) && c.alias !== ramp.alias && !rampPeers.has(c.alias) && !c.peers.some((p) => p.alias === ramp.alias))
    .sort((a, b) => b.peers.length - a.peers.length || a.index - b.index);
  const dead = deadCandidates[0];
  if (!dead) throw new Error("no healthy sensor outside the peer set of the ramp sensor");
  return { rampFrom, deadFrom, ramp, dead };
}

const { sensors, episodes } = await collectEpisodes();
const rows = episodes.flatMap((e) => e.rows);
writeStream(sensors, rows);
const clean = await loadSource(out);
if (clean.grid.aliases.length !== sensors.length || clean.grid.n !== rows.length || clean.stats.episodes !== episodes.length) {
  throw new Error(`the adapter read ${clean.grid.aliases.length} sensors, ${clean.grid.n} rows and ${clean.stats.episodes} episodes from ${out}`);
}
const { rampFrom, deadFrom, ramp, dead } = analyze(clean.grid);
const rng = mulberry32(SEED);
const ramped = injectFault(clean.grid.values[ramp.index]!, { kind: "bias", from: rampFrom, magnitude: ramp.magnitude }, rng);
const killed = injectFault(clean.grid.values[dead.index]!, { kind: "dead", from: deadFrom, magnitude: 0 }, rng);
for (let t = rampFrom; t < rows.length; t++) rows[t]![1 + ramp.index] = format(ramped[t]!, rows[t]![1 + ramp.index]!);
for (let t = deadFrom; t < rows.length; t++) rows[t]![1 + dead.index] = rows[deadFrom]![1 + dead.index]!;
writeStream(sensors, rows);

const processEpisode = episodes.findIndex((e) => e.fault === PROCESS_FAULT);
const episodeStart = episodes.slice(0, processEpisode).reduce((s, e) => s + e.rows.length, 0);
const truth = {
  source: inputArg,
  output: outArg,
  rows: rows.length,
  sensors: sensors.length,
  episodes: episodes.map((e, i) => ({ fault: e.fault, run: e.run, from: i * 960, to: (i + 1) * 960 })),
  sampleMs: SAMPLE_MS,
  t0: new Date(T0).toISOString(),
  note: "The time column is synthetic: 3 min steps from t0. The sample column is the TEP episode counter.",
  faults: [
    {
      kind: "bias",
      alias: ramp.alias,
      sensor: sensors[ramp.index],
      from: rampFrom,
      to: rows.length,
      magnitude: ramp.magnitude,
      residualSigma: ramp.sigma,
      sigmaAtEnd: Math.abs(ramp.magnitude) / ramp.sigma,
      baselineP1: ramp.p1,
      baselineP99: ramp.p99,
      lastBlockMedian: ramp.lastMedian,
      peers: ramp.peers.map((p) => ({ alias: p.alias, rho: p.rho, lag: p.lag })),
    },
    { kind: "dead", alias: dead.alias, sensor: sensors[dead.index], from: deadFrom, to: rows.length, heldValue: killed[deadFrom] },
  ],
  process: { faultNumber: PROCESS_FAULT, simulationRun: PROCESS_RUN, episodeStart, onset: episodeStart + FAULT_SAMPLE, to: rows.length },
};
writeFileSync(truthPath, JSON.stringify(truth, null, 2) + "\n");

console.log(`wrote ${outArg}: ${rows.length} rows, ${sensors.length} sensors, ${episodes.length} episodes`);
console.log(
  `ramp on ${ramp.alias} (${sensors[ramp.index]}) from row ${rampFrom}: ${ramp.magnitude.toPrecision(4)} units = ${(Math.abs(ramp.magnitude) / ramp.sigma).toFixed(1)} residual sigma, ` +
    `baseline p1 ${ramp.p1.toPrecision(4)} to p99 ${ramp.p99.toPrecision(4)}, last median ${ramp.lastMedian.toPrecision(4)}, peers ${ramp.peers.map((p) => `${p.alias} (${p.rho.toFixed(2)})`).join(", ")}`,
);
console.log(`dead ${dead.alias} (${sensors[dead.index]}) from row ${deadFrom}, held at ${rows[deadFrom]![1 + dead.index]}, ${dead.peers.length} strong peers`);
console.log(`fault ${PROCESS_FAULT} run ${PROCESS_RUN}: episode starts at row ${episodeStart}, onset row ${episodeStart + FAULT_SAMPLE}`);
console.log(`wrote ${truthPath}`);
