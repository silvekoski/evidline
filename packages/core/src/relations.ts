import type { ChartSeries, Fingerprint, HealthValue, RedundancyGroup, Relation, Thresholds, Window } from "@tpm/schemas";
import { crossCorrelation, pearson, ranks, type CrossCorrelation } from "./stats/correlation";
import { bucketMeans, roundSig } from "./stats/series";
import { type EvidenceInput, type EvidenceSink, type Grid, type Masks, window } from "./types";

export type Peer = { alias: string; lag: number; rho: number; n: number };

export type RelationGraph = {
  relations: Relation[];
  groups: RedundancyGroup[];
  flowOrder: string[];
  peers: Map<string, Peer[]>;
};

type Kept = { relation: Relation; n: number };

type Edge = { from: string; to: string; weight: number };

const COPY_POINTS = 8192;
const MAX_LAG = 32;
const EDGE_GAIN = 0.02;
const PEER_LIMIT = 5;

function sensorSeries(alias: string, style: ChartSeries["style"] = "solid"): ChartSeries {
  return { key: alias, label: alias, source: { sensor: alias }, style };
}

function lagEvidence(a: string, b: string, xc: CrossCorrelation, bucket: number, rho: number, n: number, baseline: Window): EvidenceInput {
  const forward = xc.bestLag > 0;
  const [leader, follower] = forward ? [a, b] : [b, a];
  const lag = Math.abs(xc.bestLag) * bucket;
  const rho0 = xc.rhos[MAX_LAG]!;
  const lags = xc.lags.map((l, k) => ({ lag: (forward ? l : -l) * bucket, rho: xc.rhos[k]! }));
  if (!forward) lags.reverse();
  return {
    kind: "lag",
    sensors: [leader, follower],
    window: baseline,
    method: "xcorr",
    stats: { lag, rhoAtLag: xc.bestRho, rho0, rho, n, bucket },
    verdict: `${leader} leads ${follower} by ${lag} samples (rho ${roundSig(xc.bestRho)} at the best lag, ${roundSig(rho0)} at lag 0).`,
    chart: {
      type: "lag",
      window: baseline,
      series: [sensorSeries(leader), sensorSeries(follower, "dashed")],
      lags,
      marks: [{ at: lag, label: `best lag ${lag}`, kind: "best-lag" }],
    },
  };
}

function topologicalOrder(nodes: string[], edges: Edge[]): { order: string[]; broken: number } {
  const indeg = new Map(nodes.map((a) => [a, 0]));
  const into = new Map(nodes.map((a) => [a, [] as Edge[]]));
  const outOf = new Map(nodes.map((a) => [a, [] as Edge[]]));
  for (const e of edges) {
    indeg.set(e.to, indeg.get(e.to)! + 1);
    into.get(e.to)!.push(e);
    outOf.get(e.from)!.push(e);
  }
  const dead = new Set<Edge>();
  const placed = new Set<string>();
  const order: string[] = [];
  let broken = 0;
  const drop = (e: Edge) => {
    dead.add(e);
    indeg.set(e.to, indeg.get(e.to)! - 1);
  };
  while (order.length < nodes.length) {
    const ready = nodes.find((a) => !placed.has(a) && indeg.get(a) === 0);
    if (ready !== undefined) {
      order.push(ready);
      placed.add(ready);
      for (const e of outOf.get(ready)!) if (!dead.has(e)) drop(e);
      continue;
    }
    const path: Edge[] = [];
    const at = new Map<string, number>();
    let node = nodes.find((a) => !placed.has(a))!;
    while (!at.has(node)) {
      at.set(node, path.length);
      const e = into.get(node)!.find((x) => !dead.has(x) && !placed.has(x.from))!;
      path.push(e);
      node = e.from;
    }
    drop(path.slice(at.get(node)!).reduce((weakest, e) => (e.weight < weakest.weight ? e : weakest)));
    broken++;
  }
  return { order, broken };
}

export function relationGraph(
  grid: Grid,
  masks: Masks,
  health: { value: HealthValue }[],
  baseline: Window,
  fps: Fingerprint[],
  thresholds: Pick<Thresholds, "relationRho" | "redundancyRho">,
  sink: EvidenceSink,
): RelationGraph {
  const { aliases } = grid;
  const index = new Map(aliases.map((a, i) => [a, i]));
  const bucket = Math.max(1, Math.ceil(baseline.n / COPY_POINTS));
  const episodes = grid.episodes.flatMap((e) => {
    const from = Math.max(e.from, baseline.from) - baseline.from;
    const to = Math.min(e.to, baseline.to) - baseline.from;
    return to > from ? [window(Math.round(from / bucket), Math.round(to / bucket))] : [];
  });
  const rank = aliases.map((_, i) => {
    if (fps[i]!.signalType === "constant") return null;
    const x = grid.values[i]!.slice(baseline.from, baseline.to);
    const mask = masks[i]!;
    for (let t = 0; t < x.length; t++) if (mask[baseline.from + t]) x[t] = NaN;
    return ranks(x);
  });
  const copies = new Map<number, Float64Array>();
  const copy = (i: number) => {
    let c = copies.get(i);
    if (!c) {
      c = bucketMeans(rank[i]!, bucket);
      copies.set(i, c);
    }
    return c;
  };

  const kept: Kept[] = [];
  for (let i = 0; i < aliases.length; i++) {
    const ra = rank[i];
    if (!ra) continue;
    for (let j = i + 1; j < aliases.length; j++) {
      const rb = rank[j];
      if (!rb) continue;
      const { rho, n } = pearson(ra, rb);
      if (Math.abs(rho) < thresholds.relationRho) continue;
      const a = aliases[i]!;
      const b = aliases[j]!;
      const correlationId = sink.add({
        kind: "correlation",
        sensors: [a, b],
        window: baseline,
        method: "spearman",
        stats: { rho, n },
        verdict: `${a} and ${b} have Spearman rho ${roundSig(rho)} on ${n} baseline samples.`,
        chart: { type: "scatter", window: baseline, series: [sensorSeries(a), sensorSeries(b)] },
      });
      const xc = crossCorrelation(copy(i), copy(j), MAX_LAG, episodes);
      const directed = xc.bestLag !== 0 && Math.abs(xc.bestRho) > Math.abs(xc.rhos[MAX_LAG]!) + EDGE_GAIN;
      const evidenceId = directed ? sink.add(lagEvidence(a, b, xc, bucket, rho, n, baseline)) : correlationId;
      kept.push({
        relation: { a, b, rho, lag: directed ? xc.bestLag * bucket : 0, rhoAtLag: directed ? xc.bestRho : rho, evidenceId },
        n,
      });
    }
  }

  const parent = new Map(aliases.map((a) => [a, a]));
  const root = (a: string): string => {
    const p = parent.get(a)!;
    if (p === a) return a;
    const r = root(p);
    parent.set(a, r);
    return r;
  };
  const redundant = kept.filter(({ relation }) => Math.abs(relation.rho) >= thresholds.redundancyRho);
  for (const { relation } of redundant) parent.set(root(relation.a), root(relation.b));
  const members = new Map<string, string[]>();
  for (const a of aliases) {
    const r = root(a);
    members.set(r, [...(members.get(r) ?? []), a]);
  }
  const groups: RedundancyGroup[] = [...members.values()]
    .filter((sensors) => sensors.length >= 2)
    .map((sensors) => {
      const inside = new Set(sensors);
      const rhos = redundant.filter(({ relation }) => inside.has(relation.a)).map(({ relation }) => Math.abs(relation.rho));
      const minRho = Math.min(...rhos);
      const evidenceId = sink.add({
        kind: "structure",
        sensors,
        window: baseline,
        method: "redundancy-group",
        stats: { size: sensors.length, pairs: rhos.length, minRho, maxRho: Math.max(...rhos) },
        verdict: `${sensors.join(", ")} measure the same quantity: |rho| at lag 0 is at least ${roundSig(minRho)} inside the group.`,
        chart: { type: "line", window: baseline, series: sensors.map((a, k) => sensorSeries(a, k === 0 ? "solid" : "thin")) },
      });
      return { sensors, evidenceId };
    });

  const edges: Edge[] = kept
    .filter(({ relation }) => relation.lag !== 0)
    .map(({ relation: r }) => (r.lag > 0 ? { from: r.a, to: r.b, weight: Math.abs(r.rhoAtLag) } : { from: r.b, to: r.a, weight: Math.abs(r.rhoAtLag) }));
  const linked = new Set(edges.flatMap((e) => [e.from, e.to]));
  const { order, broken } = topologicalOrder(
    aliases.filter((a) => linked.has(a)),
    edges,
  );
  const net = new Map(order.map((a) => [a, 0]));
  for (const e of edges) {
    net.set(e.from, net.get(e.from)! + 1);
    net.set(e.to, net.get(e.to)! - 1);
  }
  sink.add({
    kind: "structure",
    sensors: order,
    window: baseline,
    method: "topological-sort",
    stats: { nodes: order.length, edges: edges.length, broken },
    verdict:
      order.length > 0
        ? `Flow order ${order.join(", ")} from ${edges.length} directed edges, ${broken} cycles broken.`
        : "No directed edge, so there is no flow order.",
    chart: { type: "bar", window: baseline, series: [], bars: order.map((a) => ({ label: a, value: net.get(a)! })) },
  });

  const failed = new Set(health.filter((h) => h.value.health !== "healthy").map((h) => h.value.sensor));
  const candidates = new Map(aliases.map((a) => [a, [] as Peer[]]));
  for (const { relation: r, n } of kept) {
    if (!failed.has(r.b)) candidates.get(r.a)!.push({ alias: r.b, lag: -r.lag, rho: r.rho, n });
    if (!failed.has(r.a)) candidates.get(r.b)!.push({ alias: r.a, lag: r.lag, rho: r.rho, n });
  }
  const peers = new Map(
    [...candidates].map(([alias, list]) => [
      alias,
      list.sort((p, q) => Math.abs(q.rho) - Math.abs(p.rho) || index.get(p.alias)! - index.get(q.alias)!).slice(0, PEER_LIMIT),
    ]),
  );

  return { relations: kept.map(({ relation }) => relation), groups, flowOrder: order, peers };
}
