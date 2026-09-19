import { healthBlockSize } from "./health";
import type {
  ChartSeries,
  DiagnosisValue,
  FaultClass,
  Fingerprint,
  HealthValue,
  Overrides,
  RankedSensor,
  Relation,
  Role,
  Thresholds,
  Window,
} from "@tpm/schemas";
import { faultLabel, healthToFault } from "@tpm/schemas";
import type { DriftResult } from "./drift";
import { fitPca, pcaStatistics, type PcaModel } from "./pca";
import type { RelationGraph } from "./relations";
import type { RoleResult } from "./roles";
import { acfTime, blockMedians, dominantPeriod, mannKendall, median, noiseLevel, spearman, theilSen } from "./stats";
import { buildTrace, listing, sig, type Cited } from "./trace";
import { window, type EvidenceInput, type EvidenceSink, type Grid, type Masks } from "./types";

type StageResult<V> = { value: V; claim: string; confidence: number; evidenceIds: string[] };
type HealthResult = StageResult<HealthValue> & { mask: Uint8Array };

export type FaultContext = {
  grid: Grid;
  masks: Masks;
  fps: Fingerprint[];
  baseline: Window;
  health: HealthResult[];
  graph: RelationGraph;
  roles: RoleResult[];
  drifts: DriftResult[];
  thresholds: Thresholds;
  changepoints: Map<string, number[]>;
};

export type Incident = StageResult<DiagnosisValue>;

type Shared = { cited: Cited; index: number | null; share: number };

type Prepared = FaultContext & {
  sink: EvidenceSink;
  overrides: Overrides;
  n: number;
  healthOf: Map<string, HealthResult>;
  roleOf: Map<string, Role>;
  acfOf: Map<string, number>;
  excluded: string[];
  drifting: Map<string, DriftResult>;
  drivers: string[];
  victims: Map<string, string[]>;
  sources: Map<string, string[]>;
  neighbors: Map<string, Set<string>>;
  pca: PcaModel | null;
  shared: Shared;
};

type Group = { drivers: string[]; onset: number | null; until: number };

type Loop = { actuator: string; controlled: string; downstream: string[]; shifted: string[] };

type Kind = {
  faultClass: FaultClass;
  blocks: number;
  slopePer1000: number;
  mkZ: number;
  pValue: number;
  jump: number;
  span: number;
  period: number;
};

const MIN_WINDOW = 100;

export function separateFaults(ctx: FaultContext, sink: EvidenceSink, overrides: Overrides = {}): Incident[] {
  const p = prepare(ctx, sink, overrides);
  return [...healthIncidents(p), ...driverGroups(p).map((g) => diagnose(p, g))];
}

function add(sink: EvidenceSink, e: EvidenceInput, derived?: Record<string, Float64Array>): Cited {
  return { id: sink.add(e, derived), stats: e.stats };
}

function series(alias: string, style: ChartSeries["style"], key = alias): ChartSeries {
  return { key, label: alias, source: { sensor: alias }, style };
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

function ratio(a: number, b: number): number {
  return b === 0 ? 1 : a / b;
}

function neighborsOf(ctx: FaultContext): Map<string, Set<string>> {
  const out = new Map(ctx.grid.aliases.map((a) => [a, new Set<string>()]));
  for (const r of ctx.graph.relations) {
    out.get(r.a)?.add(r.b);
    out.get(r.b)?.add(r.a);
  }
  return out;
}

function related(p: Prepared, a: string, b: string): boolean {
  const near = p.neighbors.get(a);
  const far = p.neighbors.get(b);
  return near !== undefined && far !== undefined && (near.has(b) || [...near].some((c) => far.has(c)));
}

function directed(r: Relation): boolean {
  return r.lag !== 0 && Math.abs(r.rhoAtLag) > Math.abs(r.rho) + 0.02;
}

function leads(p: Prepared, a: string): string[] {
  return p.graph.relations
    .filter((r) => directed(r) && ((r.a === a && r.lag > 0) || (r.b === a && r.lag < 0)))
    .map((r) => (r.a === a ? r.b : r.a));
}

function prepare(ctx: FaultContext, sink: EvidenceSink, overrides: Overrides): Prepared {
  const healthOf = new Map(ctx.health.map((h) => [h.value.sensor, h]));
  const roleOf = new Map(ctx.roles.map((r) => [r.value.sensor, overrides.roles?.[r.value.sensor] ?? r.value.role]));
  const { baseline } = ctx;
  const baselineEpisodes = ctx.grid.episodes
    .filter((e) => e.to > baseline.from && e.from < baseline.to)
    .map((e) => window(Math.max(e.from, baseline.from) - baseline.from, Math.min(e.to, baseline.to) - baseline.from));
  const acfOf = new Map(ctx.grid.aliases.map((a, i) => [a, acfTime(ctx.grid.values[i]!.subarray(baseline.from, baseline.to), baselineEpisodes)]));
  const excluded = [
    ...new Set([...(overrides.masked ?? []), ...ctx.health.filter((h) => h.value.health !== "healthy").map((h) => h.value.sensor)]),
  ].sort();
  const drifting = new Map(ctx.drifts.filter((d) => d.value.drifting && !excluded.includes(d.value.sensor)).map((d) => [d.value.sensor, d]));
  const victimOf = (alias: string): string | null => {
    const override = overrides.responsible?.[alias];
    const source = override === undefined ? drifting.get(alias)!.victimOf : override === alias ? null : override;
    return source !== null && drifting.has(source) ? source : null;
  };
  const drivers = [...drifting.keys()].filter((a) => victimOf(a) === null);
  const victims = new Map<string, string[]>();
  for (const a of drifting.keys()) {
    const driver = victimOf(a);
    if (driver !== null) victims.set(driver, [...(victims.get(driver) ?? []), a]);
  }
  const pcaSensors = ctx.grid.aliases.filter((a, i) => ctx.fps[i]?.signalType !== "constant" && !excluded.includes(a));
  const sources = new Map<string, string[]>();
  for (const set of ctx.grid.siblings ?? []) {
    for (const a of set) {
      if (!drivers.includes(a)) continue;
      const others = set.filter((b) => b !== a && !excluded.includes(b));
      if (others.length > 0 && others.every((b) => !drifting.has(b) || victimOf(b) === a)) sources.set(a, others);
    }
  }
  return {
    ...ctx,
    sink,
    overrides,
    n: ctx.grid.n,
    healthOf,
    roleOf,
    acfOf,
    excluded,
    drifting,
    drivers,
    victims,
    sources,
    neighbors: neighborsOf(ctx),
    pca: fitPca(ctx.grid, ctx.baseline, pcaSensors),
    shared: sharedChangepoint(ctx, sink),
  };
}

function sharedChangepoint(ctx: FaultContext, sink: EvidenceSink): Shared {
  const { grid, fps, changepoints } = ctx;
  const { n } = grid;
  const tolerance = Math.max(2, Math.floor(0.001 * n));
  const counted = grid.aliases.filter((_, i) => fps[i]?.signalType !== "constant");
  const boundaries = grid.episodes.flatMap((e) => [e.from, e.to]);
  const points = counted.flatMap((alias) =>
    (changepoints.get(alias) ?? [])
      .filter((c) => boundaries.every((b) => Math.abs(c - b) > tolerance))
      .map((c) => ({ c, alias })),
  );
  let index: number | null = null;
  let sharing: string[] = [];
  for (const { c } of points) {
    const near = new Set(points.filter((q) => Math.abs(q.c - c) <= tolerance).map((q) => q.alias));
    if (near.size > sharing.length) {
      index = c;
      sharing = [...near].sort();
    }
  }
  const share = ratio(sharing.length, counted.length);
  const whole = window(0, n);
  const cited = add(sink, {
    kind: "changepoint",
    sensors: sharing,
    window: whole,
    method: "shared-changepoint",
    stats: { n, sensors: counted.length, sharing: sharing.length, share, ...(index === null ? {} : { index }) },
    verdict:
      index === null
        ? "No sensor has a change point away from an episode boundary."
        : `${sharing.length} of ${counted.length} sensors share a change point at sample ${index}.`,
    chart: {
      type: "line",
      window: whole,
      series: sharing.slice(0, 5).map((a) => series(a, "thin")),
      ...(index === null ? {} : { marks: [{ at: index, label: "shared change point", kind: "changepoint" as const }] }),
    },
  });
  return { cited, index, share };
}

function healthClassOf(p: Prepared, alias: string): string {
  const health = p.healthOf.get(alias)?.value.health;
  return health && health !== "healthy" ? health : "masked by the operator";
}

function healthIncidents(p: Prepared): Incident[] {
  const { n, grid } = p;
  const failed = p.health.filter((h) => h.value.health !== "healthy").sort((a, b) => a.value.sensor.localeCompare(b.value.sensor));
  const blockSize = healthBlockSize(n);
  const groups: (typeof failed)[] = [];
  for (const h of failed) {
    const onset = h.value.masked[0]?.from ?? 0;
    const group = groups.find((g) => g[0]!.value.health === h.value.health && Math.abs((g[0]!.value.masked[0]?.from ?? 0) - onset) <= blockSize);
    if (group) group.push(h);
    else groups.push([h]);
  }
  return groups.map((group) => {
    const lead = group[0]!;
    const sensors = group.map((h) => h.value.sensor);
    const cls = lead.value.health as Exclude<HealthValue["health"], "healthy">;
    const onset = Math.min(...group.map((h) => h.value.masked[0]?.from ?? 0));
    const w = window(Math.max(0, Math.min(onset, n - MIN_WINDOW)), n);
    const check = lead.value.checks.find((c) => c.check === cls);
    const statistic = check?.statistic ?? 0;
    const threshold = check?.threshold ?? 0;
    let maskedSamples = 0;
    for (const alias of sensors) {
      const mask = p.masks[grid.aliases.indexOf(alias)];
      if (mask) for (let t = w.from; t < w.to; t++) maskedSamples += mask[t]!;
    }
    const maskedShare = ratio(maskedSamples, w.n * sensors.length);
    const masked = lead.value.masked;
    const ev = add(p.sink, {
      kind: "health",
      sensors,
      window: w,
      method: cls,
      stats: { n: w.n, sensors: sensors.length, statistic, threshold, ratio: ratio(statistic, threshold), maskedShare, maskedWindows: masked.length },
      verdict: `${sensors.length} sensor${sensors.length === 1 ? "" : "s"} failed the ${cls} check from sample ${w.from}. ${lead.value.sensor}: statistic ${sig(statistic)} against threshold ${sig(threshold)}.`,
      chart: { type: "line", window: w, series: sensors.slice(0, 5).map((alias, i) => series(alias, i === 0 ? "solid" : "thin", alias)), masks: masked },
    });
    const upstream = group.flatMap((h) => h.evidenceIds.map((id) => ({ id, stats: {} })));
    const faultClass = sensors.map((alias) => p.overrides.faultClass?.[alias]).find((fc) => fc !== undefined) ?? healthToFault(cls);
    const who = sensors.length === 1 ? sensors[0]! : `${sensors[0]} and ${sensors.length - 1} more`;
    const skipped = { n: w.n, cited: [ev], keys: [], result: `Not run: ${who} ${sensors.length === 1 ? "is" : "are"} excluded by the health gate.` };
    const trace = buildTrace({
      health: {
        name: "Health gate",
        n: w.n,
        cited: [ev, ...upstream],
        keys: ["sensors", "statistic", "threshold", "ratio", "maskedShare"],
        result: `The health gate excluded ${sensors.length} sensor${sensors.length === 1 ? "" : "s"} (${cls}): ${sensors.slice(0, 6).join(", ")}${sensors.length > 6 ? ", ..." : ""}. ${lead.value.sensor}: statistic ${sig(statistic)} against threshold ${sig(threshold)}; masked share of the window ${sig(maskedShare)}.`,
      },
      drift: { name: "Drift", ...skipped },
      isolation: { name: "Isolation", ...skipped },
      propagation: { name: "Propagation", ...skipped },
      "control-loop": { name: "Control loop", ...skipped },
      verdict: {
        name: "Verdict",
        n: w.n,
        cited: [ev, ...upstream],
        keys: ["sensors", "statistic", "threshold"],
        result: `${faultLabel(faultClass)} on ${who} from sample ${w.from}. No process diagnosis uses ${sensors.length === 1 ? "this sensor" : "these sensors"}.`,
      },
    });
    return {
      value: { faultClass, window: w, onset, ranked: [], excluded: sensors, trace, prose: null, pca: null },
      claim: `${faultLabel(faultClass)} on ${who} from sample ${w.from}. No process diagnosis uses ${sensors.length === 1 ? "this sensor" : "these sensors"}.`,
      confidence: 1,
      evidenceIds: [...new Set(trace.flatMap((s) => s.evidenceIds))],
    };
  });
}

function onsetForGrouping(p: Prepared, alias: string): number {
  return p.drifting.get(alias)?.value.onset ?? p.baseline.to;
}

function driverGroups(p: Prepared): Group[] {
  const { drivers, n } = p;
  const parent = drivers.map((_, i) => i);
  const find = (i: number): number => {
    const q = parent[i]!;
    if (q === i) return i;
    const root = find(q);
    parent[i] = root;
    return root;
  };
  const coincide = (a: string, b: string): boolean =>
    Math.abs(onsetForGrouping(p, a) - onsetForGrouping(p, b)) <= Math.max(2 * Math.max(p.acfOf.get(a)!, p.acfOf.get(b)!), 0.01 * n);
  for (let i = 0; i < drivers.length; i++) {
    for (let j = i + 1; j < drivers.length; j++) {
      if (related(p, drivers[i]!, drivers[j]!) && coincide(drivers[i]!, drivers[j]!)) parent[find(i)] = find(j);
    }
  }
  const members = new Map<number, string[]>();
  drivers.forEach((a, i) => members.set(find(i), [...(members.get(find(i)) ?? []), a]));
  const plantWide = Math.max(3, Math.ceil(0.1 * p.grid.aliases.length));
  for (const [root, group] of members) {
    if (group.length < plantWide) continue;
    for (let i = 0; i < drivers.length; i++) {
      if (find(i) !== root && group.some((a) => coincide(a, drivers[i]!))) parent[find(i)] = root;
    }
  }
  const merged = new Map<number, string[]>();
  drivers.forEach((a, i) => merged.set(find(i), [...(merged.get(find(i)) ?? []), a]));
  const groups = [...merged.values()]
    .flatMap((group) => {
      const source = group.filter((a) => p.sources.has(a));
      return source.length > 0 && source.length < group.length ? [source, group.filter((a) => !p.sources.has(a))] : [group];
    })
    .map((group) => {
      const onsets = group.map((a) => p.drifting.get(a)!.value.onset).filter((o): o is number => o !== null);
      return { drivers: group.sort(), onset: onsets.length > 0 ? Math.min(...onsets) : null };
    })
    .sort((x, y) => (x.onset ?? n) - (y.onset ?? n) || x.drivers[0]!.localeCompare(y.drivers[0]!));
  return groups.map((g, i) => ({ ...g, until: groups[i + 1]?.onset ?? n }));
}

type ScaleChange = { levelRatio: number; spreadRatio: number; gain: boolean };

function scaleChange(x: Float64Array, baseline: Window, span: Window): ScaleChange {
  const finite = (w: Window) => x.subarray(w.from, w.to).filter((v) => Number.isFinite(v));
  const base = finite(baseline);
  const post = finite(span);
  if (base.length < 10 || post.length < 10) return { levelRatio: 1, spreadRatio: 1, gain: false };
  const baseMedian = median(base);
  const postMedian = median(post);
  const baseSpread = noiseLevel(base);
  const postSpread = noiseLevel(post);
  const levelRatio = baseMedian !== 0 && Math.sign(baseMedian) === Math.sign(postMedian) ? postMedian / baseMedian : 1;
  const spreadRatio = baseSpread > 0 ? postSpread / baseSpread : 1;
  const level = Math.abs(Math.log(levelRatio));
  const spread = Math.log(spreadRatio);
  const gain = level > 0.05 && Math.sign(spread) === Math.sign(Math.log(levelRatio)) && Math.abs(spread) > 0.5 * level;
  return { levelRatio, spreadRatio, gain };
}

function gainReason(gain: boolean, rho: number, scale: ScaleChange): string {
  return gain
    ? `the deviation scales with the level (|rho| ${sig(Math.abs(rho))}; level x${sig(scale.levelRatio)}, spread x${sig(scale.spreadRatio)})`
    : `the deviation does not depend on the level (|rho| ${sig(Math.abs(rho))}; level x${sig(scale.levelRatio)}, spread x${sig(scale.spreadRatio)})`;
}

function rank(p: Prepared, drivers: string[], victims: string[]): RankedSensor[] {
  const members = [...drivers, ...victims];
  const raw = members.map((a) => p.drifting.get(a)?.value.maxDeviation ?? 0);
  const total = raw.reduce((s, v) => s + v, 0);
  const tier = new Set(drivers);
  return members
    .map((sensor, i) => ({
      sensor,
      contribution: total > 0 ? raw[i]! / total : 1 / members.length,
      onset: p.drifting.get(sensor)?.value.onset ?? null,
    }))
    .sort(
      (x, y) =>
        Number(tier.has(y.sensor)) - Number(tier.has(x.sensor)) ||
        y.contribution - x.contribution ||
        (x.onset ?? p.n) - (y.onset ?? p.n) ||
        x.sensor.localeCompare(y.sensor),
    );
}

function findLoop(p: Prepared, drivers: string[]): Loop | null {
  for (const actuator of drivers) {
    if (p.roleOf.get(actuator) !== "actuator") continue;
    for (const controlled of leads(p, actuator)) {
      if (p.roleOf.get(controlled) !== "controlled" || p.drifting.has(controlled)) continue;
      const downstream = [...new Set([...leads(p, actuator), ...leads(p, controlled)])]
        .filter((a) => a !== actuator && a !== controlled && !p.excluded.includes(a))
        .sort();
      return { actuator, controlled, downstream, shifted: downstream.filter((a) => p.drifting.has(a)) };
    }
  }
  return null;
}

function processKind(p: Prepared, deviation: Float64Array, lead: string, span: Window): Kind {
  const { n } = p;
  const { from, to } = span;
  const block = Math.max(1, Math.floor(n / 200));
  const { centers, medians } = blockMedians(Float64Array.from(deviation, (v) => Math.abs(v)), block, from, to);
  const fit = theilSen(Float64Array.from(medians), Float64Array.from(centers));
  const mk = mannKendall(Float64Array.from(medians));
  const reach = Math.max(2, Math.ceil(2 * p.acfOf.get(lead)!));
  const before = median(deviation.subarray(Math.max(0, from - reach), from));
  const after = median(deviation.subarray(from, Math.min(to, from + reach)));
  const jump = Math.abs(after - before);
  const period = dominantPeriod(deviation.subarray(from, to), 0.5) ?? 0;
  const faultClass: FaultClass =
    medians.length >= 4 && mk.p < 0.01 && fit.slope > 0
      ? "process-slow-degradation"
      : jump > 2
        ? "process-step"
        : period > 0
          ? "process-oscillation"
          : "process-degradation";
  return { faultClass, blocks: medians.length, slopePer1000: 1000 * fit.slope, mkZ: mk.z, pValue: mk.p, jump, span: reach, period };
}

function maxDeviationOf(p: Prepared, alias: string): number {
  return p.drifts.find((d) => d.value.sensor === alias)?.value.maxDeviation ?? 0;
}

function diagnose(p: Prepared, group: Group): Incident {
  const { grid, n, thresholds } = p;
  const onset = group.onset;
  const from = Math.max(0, Math.min(onset ?? p.baseline.to, n - MIN_WINDOW));
  const w = window(from, n);
  const span = window(from, Math.min(n, Math.max(group.until, from + MIN_WINDOW)));
  const victims = [...new Set(group.drivers.flatMap((d) => p.victims.get(d) ?? []))].sort();
  const pca = p.pca ? pcaStatistics(p.pca, grid, span) : null;
  const ranked = rank(p, group.drivers, victims);
  const lead = ranked.find((r) => group.drivers.includes(r.sensor))!.sensor;
  const drift = p.drifting.get(lead)!;
  const model = drift.model;
  const single = group.drivers.length === 1;

  const level = model ? spearman(model.deviation.subarray(span.from, span.to), model.expected.subarray(span.from, span.to)) : { rho: 0, n: 0 };
  const scale = scaleChange(grid.values[grid.aliases.indexOf(lead)]!, p.baseline, span);
  const gain = model !== null && (Math.abs(level.rho) > 0.5 || scale.gain);
  const peers = (p.graph.peers.get(lead) ?? []).map((q) => q.alias);
  const peerDrivers = peers.filter((a) => p.drivers.includes(a)).length;
  const redundancy = p.graph.groups.find((g) => g.sensors.includes(lead)) ?? null;
  const groupOthers = redundancy ? redundancy.sensors.filter((a) => a !== lead) : [];
  const groupDrivers = groupOthers.filter((a) => p.drivers.includes(a)).length;
  const loop = findLoop(p, group.drivers);
  const kind = model ? processKind(p, model.deviation, lead, span) : null;

  const onsets = new Map(ranked.filter((r) => r.onset !== null).map((r) => [r.sensor, r.onset!]));
  let edges = 0;
  let agree = 0;
  for (const r of p.graph.relations) {
    const oa = onsets.get(r.a);
    const ob = onsets.get(r.b);
    if (!directed(r) || oa === undefined || ob === undefined) continue;
    edges++;
    if (ob === oa || Math.sign(ob - oa) === Math.sign(r.lag)) agree++;
  }
  const onsetValues = [...onsets.values()];
  const onsetSpan = onsetValues.length > 0 ? Math.max(...onsetValues) - Math.min(...onsetValues) : 0;

  const pcaEv = add(p.sink, {
    kind: "structure",
    sensors: ranked.map((r) => r.sensor),
    window: span,
    method: "pca",
    stats: {
      n: pca?.n ?? w.n,
      sensors: p.pca?.sensors.length ?? 0,
      components: p.pca?.components ?? 0,
      excluded: p.excluded.length,
      ...(pca && p.pca ? { t2: pca.t2, t2Limit: p.pca.t2Limit, spe: pca.spe, speLimit: p.pca.speLimit } : {}),
      ...Object.fromEntries(ranked.map((r) => [`pca_${r.sensor}`, pca?.contributions.get(r.sensor) ?? 0])),
    },
    verdict:
      pca && p.pca
        ? pca.spe > p.pca.speLimit
          ? `SPE ${sig(pca.spe)} exceeds ${sig(p.pca.speLimit)}: the relations broke.`
          : pca.t2 > p.pca.t2Limit
            ? `T2 ${sig(pca.t2)} exceeds ${sig(p.pca.t2Limit)} with SPE inside its limit: the process moved inside its relations.`
            : `T2 ${sig(pca.t2)} and SPE ${sig(pca.spe)} stay inside their limits.`
        : "No PCA model: fewer than two healthy non-constant sensors.",
    chart: { type: "bar", window: span, series: [], bars: ranked.map((r) => ({ label: r.sensor, value: pca?.contributions.get(r.sensor) ?? 0 })) },
  });
  const onsetEv = add(p.sink, {
    kind: "lag",
    sensors: ranked.map((r) => r.sensor),
    window: w,
    method: "onset-order",
    stats: {
      n: w.n,
      sensors: ranked.length,
      drivers: group.drivers.length,
      victims: victims.length,
      onsetSpan,
      edges,
      agree,
      lagAgreement: ratio(agree, edges),
      ...Object.fromEntries([...onsets].map(([a, o]) => [`onset_${a}`, o])),
    },
    verdict: `${agree} of ${edges} lead-lag edges agree with the onset order; onsets span ${onsetSpan} samples.`,
    chart: {
      type: "line",
      window: w,
      series: ranked.slice(0, 6).map((r, i) => series(r.sensor, i === 0 ? "solid" : "thin")),
      marks: [...onsets].map(([a, o]) => ({ at: o, label: `${a} onset`, kind: "onset" as const })),
    },
  });
  const isoEv = add(
    p.sink,
    {
      kind: "residual",
      sensors: [lead, ...peers],
      window: span,
      method: "spearman",
      stats: {
        n: span.n,
        pairs: level.n,
        levelRho: Math.abs(level.rho),
        levelRatio: scale.levelRatio,
        spreadRatio: scale.spreadRatio,
        maxDeviation: drift.value.maxDeviation,
        deviationLimit: thresholds.deviationLimit,
        peers: peers.length,
        peerDrivers,
        groupSize: redundancy ? redundancy.sensors.length : 0,
        groupDrivers,
        siblings: p.sources.get(lead)?.length ?? 0,
        siblingDrivers: 0,
        loop: loop ? 1 : 0,
        controlledDeviation: loop ? maxDeviationOf(p, loop.controlled) : 0,
        actuatorDeviation: loop ? maxDeviationOf(p, loop.actuator) : 0,
        downstream: loop ? loop.downstream.length : 0,
        downstreamShifted: loop ? loop.shifted.length : 0,
        ...Object.fromEntries(ranked.map((r) => [`contrib_${r.sensor}`, r.contribution])),
      },
      verdict: model
        ? `${lead} deviates up to ${sig(drift.value.maxDeviation)} from its ${peers.length} peers; |rho| between deviation and level ${sig(Math.abs(level.rho))}.`
        : `${lead} drifts against its own baseline distribution; no peer model.`,
      chart: {
        type: "line",
        window: span,
        series: [
          series(lead, "solid", "value"),
          ...(model ? [{ key: "expected", label: "expected from peers", source: { derived: "expected" }, style: "dashed" as const }] : []),
          ...peers.slice(0, 5).map((a) => series(a, "thin")),
        ],
        ...(model ? { secondary: [{ key: "deviation", label: "deviation", source: { derived: "deviation" }, style: "solid" as const }] } : {}),
        threshold: thresholds.deviationLimit,
        ...(onset === null ? {} : { marks: [{ at: onset, label: "onset", kind: "onset" as const }] }),
      },
    },
    model ? { expected: model.expected, deviation: model.deviation } : undefined,
  );
  const kindEv =
    model && kind
      ? add(
          p.sink,
          {
            kind: "trend",
            sensors: [lead],
            window: span,
            method: "theil-sen",
            stats: { n: span.n, blocks: kind.blocks, slopePer1000: kind.slopePer1000, mkZ: kind.mkZ, pValue: kind.pValue, jump: kind.jump, span: kind.span, period: kind.period },
            verdict: `|deviation| of ${lead} trends ${sig(kind.slopePer1000)} per 1000 samples over ${kind.blocks} blocks (p ${sig(kind.pValue)}); jump at onset ${sig(kind.jump)}; period ${kind.period}.`,
            chart: {
              type: "line",
              window: span,
              series: [{ key: "deviation", label: "deviation", source: { derived: "deviation" }, style: "solid" }],
              ...(onset === null ? {} : { marks: [{ at: onset, label: "onset", kind: "onset" as const }] }),
            },
          },
          { deviation: model.deviation },
        )
      : null;

  const slack = Math.max(2 * p.acfOf.get(lead)!, 0.01 * n);
  const shared = p.shared;
  let row: { faultClass: FaultClass; reason: string; cited: Cited[]; keys: string[]; redundancy: boolean };
  if (shared.index !== null && shared.share >= 0.8 && onset !== null && Math.abs(onset - shared.index) <= slack) {
    row = {
      faultClass: "data-logging",
      reason: `A share of ${sig(shared.share)} of the sensors changes at sample ${shared.index}.`,
      cited: [shared.cited],
      keys: ["share", "index", "sharing"],
      redundancy: false,
    };
  } else if (group.drivers.every((a) => p.sources.has(a))) {
    const siblings = p.sources.get(lead)!;
    row = {
      faultClass: model ? (gain ? "sensor-drift-gain" : "sensor-drift-bias") : "sensor-drift",
      reason: `${lead} leaves its ${siblings.length} siblings (the same measure over other sources) while they hold; ${gainReason(gain, level.rho, scale)}.`,
      cited: [isoEv, pcaEv],
      keys: ["levelRho", "levelRatio", "spreadRatio", "maxDeviation", "siblings", "siblingDrivers"],
      redundancy: false,
    };
  } else if (single && redundancy && groupDrivers === 0) {
    row = {
      faultClass: "sensor-drift",
      reason: `${lead} leaves its redundancy group of ${redundancy.sensors.length}; the other members agree.`,
      cited: [isoEv, { id: redundancy.evidenceId, stats: {} }],
      keys: ["maxDeviation", "groupSize", "groupDrivers"],
      redundancy: true,
    };
  } else if (single && !loop) {
    row = {
      faultClass: model ? (gain ? "sensor-drift-gain" : "sensor-drift-bias") : "sensor-drift",
      reason: model
        ? `${lead} leaves its ${peers.length} peers while they stay consistent; ${gainReason(gain, level.rho, scale)}.`
        : `${lead} leaves its baseline distribution and has no peers.`,
      cited: [isoEv, pcaEv],
      keys: ["levelRho", "levelRatio", "spreadRatio", "maxDeviation", "peers", "peerDrivers", "spe", "speLimit"],
      redundancy: false,
    };
  } else if (loop) {
    const hidden = loop.shifted.length > 0;
    row = {
      faultClass: hidden ? "sensor-drift-hidden" : "process-degradation",
      reason: `${loop.controlled} holds while ${loop.actuator} trends; ${loop.shifted.length} of ${loop.downstream.length} downstream sensors ${hidden ? "shift" : "hold"}.`,
      cited: [isoEv, pcaEv],
      keys: ["controlledDeviation", "actuatorDeviation", "downstream", "downstreamShifted", "t2", "t2Limit"],
      redundancy: false,
    };
  } else {
    row = {
      faultClass: kind?.faultClass ?? "process-degradation",
      reason: `${group.drivers.length} related sensors move together and ${agree} of ${edges} lead-lag edges follow the learned lags.`,
      cited: [onsetEv, ...(kindEv ? [kindEv] : []), pcaEv],
      keys: ["drivers", "lagAgreement", "slopePer1000", "pValue", "jump", "period", "t2", "t2Limit"],
      redundancy: false,
    };
  }
  const overrideKey = ranked.map((r) => r.sensor).find((a) => p.overrides.faultClass?.[a] !== undefined);
  const faultClass = overrideKey === undefined ? row.faultClass : p.overrides.faultClass![overrideKey]!;
  const confidence = row.redundancy
    ? 0.9
    : pca && p.pca
      ? clamp01(Math.abs(ratio(pca.spe, p.pca.speLimit) - ratio(pca.t2, p.pca.t2Limit)))
      : 0.5;

  const excludedNames = p.excluded.map((a) => `${a} (${healthClassOf(p, a)})`);
  const excludedIds = p.excluded.flatMap((a) => p.healthOf.get(a)?.evidenceIds ?? []).map((id) => ({ id, stats: {} }));
  const trace = buildTrace({
    health: {
      name: "Health gate",
      n: w.n,
      cited: [pcaEv, ...excludedIds],
      keys: ["excluded", "sensors"],
      result:
        p.excluded.length > 0
          ? `The health gate excluded ${listing(excludedNames)}; ${p.pca?.sensors.length ?? 0} sensors stay in the PCA model.`
          : `The health gate excluded no sensor; ${p.pca?.sensors.length ?? 0} sensors form the PCA model.`,
    },
    drift: {
      name: "Drift",
      n: w.n,
      cited: [onsetEv, shared.cited, ...drift.evidenceIds.map((id) => ({ id, stats: {} }))],
      keys: ["drivers", "victims", "onsetSpan", "sharing", "share", "index"],
      result: `${listing(group.drivers, 5)} drift${onset === null ? "" : ` from sample ${onset}`}; ${victims.length} sensors follow; ${shared.cited.stats.sharing} of ${shared.cited.stats.sensors} sensors share a change point${shared.index === null ? "" : ` at sample ${shared.index}`}.`,
    },
    isolation: {
      name: "Isolation",
      n: w.n,
      cited: [isoEv],
      keys: ["maxDeviation", "levelRho", "peers", "peerDrivers", "groupSize", "groupDrivers", "pairs"],
      result: model
        ? `${lead} deviates up to ${sig(drift.value.maxDeviation)} against ${peers.length} peers; ${peerDrivers} peers drift; redundancy group of ${redundancy ? redundancy.sensors.length : 0} with ${groupDrivers} other drifting members; |rho| between deviation and level ${sig(Math.abs(level.rho))}.`
        : `${lead} has no peer model; ${peerDrivers} of ${peers.length} peers drift; redundancy group of ${redundancy ? redundancy.sensors.length : 0}.`,
    },
    propagation: {
      name: "Propagation",
      n: w.n,
      cited: [onsetEv, ...(kindEv ? [kindEv] : []), pcaEv],
      keys: ["drivers", "edges", "agree", "lagAgreement", "spe", "speLimit", "t2", "t2Limit", "slopePer1000", "pValue", "jump", "period"],
      result:
        `${group.drivers.length} related sensors move together; ${agree} of ${edges} lead-lag edges follow the learned lags` +
        (pca && p.pca ? `; SPE ${sig(pca.spe)} against ${sig(p.pca.speLimit)}, T2 ${sig(pca.t2)} against ${sig(p.pca.t2Limit)}` : "") +
        (kind ? `; |deviation| trend ${sig(kind.slopePer1000)} per 1000 samples (p ${sig(kind.pValue)}), jump ${sig(kind.jump)}, period ${kind.period}.` : "."),
    },
    "control-loop": {
      name: "Control loop",
      n: w.n,
      cited: [isoEv],
      keys: ["loop", "controlledDeviation", "actuatorDeviation", "downstream", "downstreamShifted"],
      result: loop
        ? `${loop.controlled} (controlled) holds at deviation ${sig(maxDeviationOf(p, loop.controlled))} while ${loop.actuator} (actuator) trends to ${sig(maxDeviationOf(p, loop.actuator))}; ${loop.shifted.length} of ${loop.downstream.length} downstream sensors shift.`
        : "No control loop: no drifting actuator leads a controlled variable that holds.",
    },
    verdict: {
      name: "Verdict",
      n: w.n,
      cited: [...row.cited, pcaEv],
      keys: row.keys,
      result: `${faultLabel(faultClass)}. ${row.reason}${overrideKey === undefined ? "" : " The operator set the fault class."}`,
    },
  });
  const others = ranked.length - 1;
  return {
    value: {
      faultClass,
      window: w,
      onset,
      ranked,
      excluded: p.excluded,
      trace,
      prose: null,
      pca: pca && p.pca ? { t2: pca.t2, t2Limit: p.pca.t2Limit, spe: pca.spe, speLimit: p.pca.speLimit } : null,
    },
    claim: `${faultLabel(faultClass)} on ${ranked[0]!.sensor}${others > 0 ? ` and ${others} more` : ""}${onset === null ? "" : ` from sample ${onset}`}; ${p.excluded.length} sensors excluded by the health gate.`,
    confidence,
    evidenceIds: [...new Set(trace.flatMap((s) => s.evidenceIds))],
  };
}
