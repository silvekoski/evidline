import { Role, type Fingerprint, type Relation, type RoleValue, type Window } from "@tpm/schemas";
import type { RelationGraph } from "./relations";
import { mad, quantiles } from "./stats/quantile";
import { roundSig } from "./stats/series";
import { type EvidenceSink, type Grid, window } from "./types";

export type RoleResult = { value: RoleValue; claim: string; confidence: number; evidenceIds: string[] };

type Edge = { from: string; to: string; lag: number; rho: number; rhoAtLag: number; evidenceId: string };

type Partner = { alias: string; rho: number; evidenceId: string };

type Candidate = { score: number; why: string; evidence: string[] };

const FLOOR = 0.3;
const RULE_LEAD_RHO = 0.5;
const RULE_PARTNER_RHO = 0.95;
const none: Candidate = { score: 0, why: "", evidence: [] };

const label: Record<Exclude<Role, "unknown">, string> = {
  setpoint: "a setpoint",
  controlled: "a controlled variable",
  actuator: "an actuator",
  redundant: "a redundant measurement",
  upstream: "an upstream driver",
  downstream: "a downstream indicator",
  counter: "a counter or clock",
  state: "a state flag",
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

const fewLevels = (distinct: number) => 1 / (1 + Math.max(0, distinct - 2) / 8);

const best = (...candidates: Candidate[]) => candidates.reduce((top, c) => (c.score > top.score ? c : top), none);

const count = (k: number, noun: string) => `${k} ${noun}${k === 1 ? "" : "s"}`;

const verb = (k: number, base: string) => (k === 1 ? `${base}s` : base);

const strongest = <T>(list: T[], by: (e: T) => number) =>
  list.reduce<T | null>((top, e) => (top === null || by(e) > by(top) ? e : top), null);

const scoresOf = (score: (r: Role) => number) => Object.fromEntries(Role.options.map((r) => [r, score(r)])) as Record<Role, number>;

export function scoreRoles(grid: Grid, fps: Fingerprint[], graph: RelationGraph, baseline: Window, sink: EvidenceSink): RoleResult[] {
  const { aliases } = grid;
  const index = new Map(aliases.map((a, i) => [a, i]));
  const fp = (a: string) => fps[index.get(a)!]!;
  const stepLike = (a: string) => fp(a).flatShare * fewLevels(fp(a).distinct);
  const rangePerMad = aliases.map((_, i) => {
    const x = grid.values[i]!.subarray(baseline.from, baseline.to);
    const q = quantiles(x);
    const scale = mad(x) || fps[i]!.step;
    return scale > 0 ? (q.p99 - q.p1) / scale : 0;
  });
  const narrowerThan = (a: string, b: string) => rangePerMad[index.get(a)!]! < rangePerMad[index.get(b)!]!;

  const into = new Map(aliases.map((a) => [a, [] as Edge[]]));
  const outOf = new Map(aliases.map((a) => [a, [] as Edge[]]));
  const flat = new Map(aliases.map((a) => [a, [] as Partner[]]));
  const pairs = new Map<string, Relation>();
  for (const r of graph.relations) {
    pairs.set(`${r.a}|${r.b}`, r);
    pairs.set(`${r.b}|${r.a}`, r);
    if (r.lag === 0) {
      flat.get(r.a)!.push({ alias: r.b, rho: r.rho, evidenceId: r.evidenceId });
      flat.get(r.b)!.push({ alias: r.a, rho: r.rho, evidenceId: r.evidenceId });
      continue;
    }
    const e = { lag: Math.abs(r.lag), rho: r.rho, rhoAtLag: r.rhoAtLag, evidenceId: r.evidenceId };
    const edge: Edge = r.lag > 0 ? { from: r.a, to: r.b, ...e } : { from: r.b, to: r.a, ...e };
    outOf.get(edge.from)!.push(edge);
    into.get(edge.to)!.push(edge);
  }
  const tracking = new Map(
    aliases.map((y) => {
      let top = none;
      for (const e of into.get(y)!) {
        const score = stepLike(e.from) * e.rhoAtLag * e.rhoAtLag;
        if (score > top.score) top = { score, why: `it tracks setpoint ${e.from} with a lag of ${e.lag} samples`, evidence: [e.evidenceId] };
      }
      return [y, top];
    }),
  );
  const leadsControlled = new Map(
    aliases.map((x) => {
      let top = none;
      for (const e of outOf.get(x)!) {
        const tracked = tracking.get(e.to)!;
        const score = Math.abs(e.rhoAtLag) * tracked.score;
        if (score > top.score) top = { score, why: `it leads controlled variable ${e.to} by ${e.lag} samples`, evidence: [e.evidenceId, ...tracked.evidence] };
      }
      return [x, top];
    }),
  );
  const followsSetpoint = (x: string) => {
    let top = none;
    for (const e of into.get(x)!) {
      const score = stepLike(e.from) * Math.abs(e.rhoAtLag);
      if (score > top.score) top = { score, why: `follows setpoint ${e.from}`, evidence: [e.evidenceId] };
    }
    return top;
  };

  const ruleActuator = new Map<string, Candidate>();
  const ruleControlled = new Map<string, Candidate>();
  for (const x of aliases) {
    const led = strongest(outOf.get(x)!.filter((e) => Math.abs(e.rho) >= RULE_LEAD_RHO), (e) => Math.abs(e.rho));
    const partner = strongest(
      flat.get(x)!.filter((p) => Math.abs(p.rho) >= RULE_PARTNER_RHO && narrowerThan(p.alias, x)),
      (p) => Math.abs(p.rho),
    );
    if (!led || !partner) continue;
    const score = Math.abs(partner.rho);
    ruleActuator.set(x, {
      score,
      why: `it leads ${led.to} and its lag-0 partner ${partner.alias} holds a narrower range`,
      evidence: [led.evidenceId, partner.evidenceId],
    });
    if (score > (ruleControlled.get(partner.alias)?.score ?? 0)) {
      ruleControlled.set(partner.alias, {
        score,
        why: `it moves with actuator ${x} at lag 0 (rho ${roundSig(partner.rho)}) and holds a narrower range`,
        evidence: [partner.evidenceId, led.evidenceId],
      });
    }
  }

  const redundant = new Map<string, Candidate>();
  for (const group of graph.groups) {
    for (const x of group.sensors) {
      for (const y of group.sensors) {
        const r = pairs.get(`${x}|${y}`);
        if (x === y || !r) continue;
        const rx = rangePerMad[index.get(x)!]!;
        const ry = rangePerMad[index.get(y)!]!;
        const score = Math.abs(r.rho) * Math.sqrt(Math.max(rx, ry) > 0 ? Math.min(rx, ry) / Math.max(rx, ry) : 1);
        if (score > (redundant.get(x)?.score ?? 0)) {
          redundant.set(x, { score, why: `it agrees with ${y} at lag 0 (rho ${roundSig(r.rho)})`, evidence: [group.evidenceId, r.evidenceId] });
        }
      }
    }
  }

  return aliases.map((alias, i) => {
    const f = fps[i]!;
    const q = f.quantiles;
    const distributionId = sink.add({
      kind: "distribution",
      sensors: [alias],
      window: window(0, grid.n),
      method: "fingerprint",
      stats: {
        n: f.n,
        missingRate: f.missingRate,
        p1: q.p1,
        p5: q.p5,
        p25: q.p25,
        p50: q.p50,
        p75: q.p75,
        p95: q.p95,
        p99: q.p99,
        mad: f.mad,
        step: f.step,
        hold: f.hold,
        noise: f.noise,
        acfTime: f.acfTime,
        ...(f.period === null ? {} : { period: f.period }),
        flatShare: f.flatShare,
        monotonicShare: f.monotonicShare,
        distinct: f.distinct,
        baselineRangePerMad: rangePerMad[i]!,
      },
      verdict: `${alias} is a ${f.signalType} signal with ${count(f.distinct, "distinct value")}, missing rate ${roundSig(f.missingRate)}, p1 ${roundSig(q.p1)} to p99 ${roundSig(q.p99)}.`,
      chart: {
        type: "histogram",
        window: window(0, grid.n),
        series: [{ key: alias, label: alias, source: { sensor: alias }, style: "solid" }],
        histograms: [{ label: alias, edges: f.histogram.edges, shares: f.histogram.shares }],
      },
    });
    if (f.signalType === "constant") {
      return {
        value: { sensor: alias, role: "unknown", scores: scoresOf(() => 0), hypothesisName: null, hypothesisConfidence: null },
        claim: `${alias} is constant, so it has no role.`,
        confidence: 0,
        evidenceIds: [distributionId],
      };
    }

    const out = outOf.get(alias)!;
    const inn = into.get(alias)!;
    const tracked = strongest(out, (e) => Math.abs(e.rhoAtLag));
    const trackedRho = tracked ? Math.abs(tracked.rhoAtLag) : 0;
    const leads = leadsControlled.get(alias)!;
    const follows = followsSetpoint(alias);
    const tracks = tracking.get(alias)!;
    const degree = out.length + inn.length;
    const levels = f.distinct === 2 ? 1 : f.distinct <= 8 ? stepLike(alias) : 0;
    const candidates: Record<Role, Candidate> = {
      setpoint: tracked
        ? {
            score: stepLike(alias) * trackedRho,
            why: `a step-like signal with ${count(f.distinct, "level")} that ${tracked.to} tracks with a lag of ${tracked.lag} samples`,
            evidence: [tracked.evidenceId],
          }
        : none,
      controlled: best({ ...tracks, score: tracks.score * (1 - leads.score) }, ruleControlled.get(alias) ?? none),
      actuator: best(
        {
          score: leads.score * (0.6 + 0.4 * follows.score) * (1 - stepLike(alias)),
          why: follows.score > 0 ? `${leads.why} and ${follows.why}` : leads.why,
          evidence: [...leads.evidence, ...follows.evidence],
        },
        ruleActuator.get(alias) ?? none,
      ),
      redundant: redundant.get(alias) ?? none,
      upstream: {
        score: degree > 0 ? (out.length / degree) * Math.min(1, out.length / 3) * (1 - stepLike(alias)) : 0,
        why: `it leads ${count(out.length, "sensor")} and ${inn.length === 0 ? "no sensor leads it" : `${inn.length} ${verb(inn.length, "lead")} it`}`,
        evidence: out.map((e) => e.evidenceId),
      },
      downstream: {
        score: degree > 0 ? (inn.length / degree) * Math.min(1, inn.length / 3) * (1 - tracks.score) : 0,
        why: `${count(inn.length, "sensor")} ${verb(inn.length, "lead")} it and it leads ${out.length === 0 ? "none" : out.length}`,
        evidence: inn.map((e) => e.evidenceId),
      },
      counter: { score: clamp01((f.monotonicShare - 0.5) / 0.5), why: `its monotonic share is ${roundSig(f.monotonicShare)}`, evidence: [] },
      state: {
        score: levels * (1 - trackedRho),
        why: `it has ${count(f.distinct, "level")} and ${tracked ? "no sensor tracks it closely" : "no sensor tracks it"}`,
        evidence: [],
      },
      unknown: none,
    };
    const ranked = Role.options.map((role) => ({ role, score: candidates[role].score })).sort((p, q) => q.score - p.score);
    const top = ranked[0]!;
    const role: Role = top.score >= FLOOR ? top.role : "unknown";
    const chosen = candidates[role];
    return {
      value: {
        sensor: alias,
        role,
        scores: scoresOf((r) => candidates[r].score),
        hypothesisName: null,
        hypothesisConfidence: null,
      },
      claim: role === "unknown" ? `${alias} has no role above the floor.` : `${alias} is ${label[role]}: ${chosen.why}.`,
      confidence: clamp01((top.score - ranked[1]!.score) * (1 - f.missingRate)),
      evidenceIds: [distributionId, ...new Set(chosen.evidence)],
    };
  });
}
