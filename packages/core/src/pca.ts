import type { Window } from "@tpm/schemas";
import { PCA } from "ml-pca";
import { quantile } from "./stats";
import type { Grid } from "./types";

export type PcaModel = {
  sensors: string[];
  columns: number[];
  components: number;
  means: Float64Array;
  stdevs: Float64Array;
  loadings: Float64Array;
  eigenvalues: Float64Array;
  t2Limit: number;
  speLimit: number;
};

export type PcaStatistics = { n: number; t2: number; spe: number; contributions: Map<string, number> };

type Scratch = { z: Float64Array; s: Float64Array; e: Float64Array; tc: Float64Array };

const MAX_FIT_ROWS = 4096;

function completeRows(grid: Grid, columns: number[], w: Window): number[] {
  const rows: number[] = [];
  for (let t = w.from; t < w.to; t++) {
    if (columns.every((c) => Number.isFinite(grid.values[c]![t]))) rows.push(t);
  }
  return rows;
}

function scratch(m: PcaModel): Scratch {
  const p = m.sensors.length;
  return { z: new Float64Array(p), s: new Float64Array(m.components), e: new Float64Array(p), tc: new Float64Array(p) };
}

function project(m: PcaModel, grid: Grid, t: number, b: Scratch): { t2: number; spe: number } {
  const p = m.sensors.length;
  const k = m.components;
  for (let i = 0; i < p; i++) b.z[i] = (grid.values[m.columns[i]!]![t]! - m.means[i]!) / m.stdevs[i]!;
  let t2 = 0;
  for (let c = 0; c < k; c++) {
    let s = 0;
    for (let i = 0; i < p; i++) s += b.z[i]! * m.loadings[c * p + i]!;
    b.s[c] = s;
    t2 += (s * s) / m.eigenvalues[c]!;
  }
  let spe = 0;
  for (let i = 0; i < p; i++) {
    let reconstructed = 0;
    let weight = 0;
    for (let c = 0; c < k; c++) {
      const l = m.loadings[c * p + i]!;
      reconstructed += b.s[c]! * l;
      weight += (b.s[c]! / m.eigenvalues[c]!) * l;
    }
    const residual = b.z[i]! - reconstructed;
    b.e[i] = residual * residual;
    b.tc[i] = weight * b.z[i]!;
    spe += residual * residual;
  }
  return { t2, spe };
}

export function fitPca(grid: Grid, baseline: Window, sensors: string[]): PcaModel | null {
  const index = new Map(grid.aliases.map((a, i) => [a, i] as const));
  const candidates = sensors.map((a) => index.get(a)).filter((c): c is number => c !== undefined);
  const rows = completeRows(grid, candidates, baseline);
  const stride = Math.max(1, Math.ceil(rows.length / MAX_FIT_ROWS));
  const sample = rows.filter((_, i) => i % stride === 0);
  const columns = candidates.filter((c) => {
    const col = grid.values[c]!;
    return sample.some((t) => col[t] !== col[sample[0]!]);
  });
  const p = columns.length;
  if (p < 2 || sample.length <= p) return null;
  const pca = new PCA(
    sample.map((t) => columns.map((c) => grid.values[c]![t]!)),
    { center: true, scale: true },
  );
  const cumulative = pca.getCumulativeVariance();
  const found = cumulative.findIndex((v) => v >= 0.9);
  const k = Math.max(1, Math.min(p - 1, (found < 0 ? cumulative.length : found + 1)));
  const U = pca.getEigenvectors();
  const loadings = new Float64Array(k * p);
  for (let c = 0; c < k; c++) for (let i = 0; i < p; i++) loadings[c * p + i] = U.get(i, c);
  const json = pca.toJSON();
  const model: PcaModel = {
    sensors: columns.map((c) => grid.aliases[c]!),
    columns,
    components: k,
    means: Float64Array.from(json.means),
    stdevs: Float64Array.from(json.stdevs),
    loadings,
    eigenvalues: Float64Array.from(pca.getEigenvalues().slice(0, k), (v) => Math.max(v, 1e-12)),
    t2Limit: 0,
    speLimit: 0,
  };
  const b = scratch(model);
  const t2s = new Float64Array(rows.length);
  const spes = new Float64Array(rows.length);
  rows.forEach((t, r) => {
    const s = project(model, grid, t, b);
    t2s[r] = s.t2;
    spes[r] = s.spe;
  });
  model.t2Limit = 1.5 * quantile(t2s, 0.99);
  model.speLimit = 1.5 * quantile(spes, 0.99);
  return model;
}

export function pcaStatistics(m: PcaModel, grid: Grid, w: Window): PcaStatistics {
  const b = scratch(m);
  const p = m.sensors.length;
  const speSum = new Float64Array(p);
  const t2Sum = new Float64Array(p);
  let n = 0;
  let t2 = 0;
  let spe = 0;
  for (const t of completeRows(grid, m.columns, w)) {
    const s = project(m, grid, t, b);
    n++;
    t2 += s.t2;
    spe += s.spe;
    for (let i = 0; i < p; i++) {
      speSum[i] = speSum[i]! + b.e[i]!;
      t2Sum[i] = t2Sum[i]! + Math.max(0, b.tc[i]!);
    }
  }
  if (n > 0) {
    t2 /= n;
    spe /= n;
  }
  const raw = spe > m.speLimit ? speSum : t2Sum;
  let total = 0;
  for (const v of raw) total += v;
  const contributions = new Map(m.sensors.map((a, i) => [a, total > 0 ? raw[i]! / total : 1 / p]));
  return { n, t2, spe, contributions };
}
