import type { Window } from "@tpm/schemas";
import type { Peer } from "./relations";
import { robustRegression, stepSize } from "./stats";
import type { Grid, Masks } from "./types";

export type PeerFit = { coef: number[]; intercept: number; sigma: number; n: number };

export type PeerPrediction = { expected: Float64Array; deviation: Float64Array };

export type PeerModel = PeerFit & {
  sensor: string;
  peers: Peer[];
  predict(grid: Grid, masks: Masks): PeerPrediction;
};

export function maskedValues(grid: Grid, masks: Masks, index: number): Float64Array {
  const mask = masks[index];
  return Float64Array.from(grid.values[index]!, (v, t) => (mask && mask[t] === 1 ? NaN : v));
}

export function alignPeers(grid: Grid, masks: Masks, peers: Peer[]): Float64Array[] {
  return peers.map((peer) => {
    const j = grid.aliases.indexOf(peer.alias);
    const source = grid.values[j]!;
    const mask = masks[j];
    const out = new Float64Array(grid.n).fill(NaN);
    for (const { from, to } of grid.episodes) {
      for (let t = from; t < to; t++) {
        const s = t - peer.lag;
        if (s >= from && s < to && !(mask && mask[s] === 1)) out[t] = source[s]!;
      }
    }
    return out;
  });
}

export function fitColumns(y: Float64Array, columns: Float64Array[], step: number): PeerFit {
  const fit = robustRegression(columns, y, { iterations: 5 });
  return { coef: fit.coef, intercept: fit.intercept, sigma: Math.max(fit.sigma, step) || 1, n: fit.n };
}

export function predictRange(fit: PeerFit, y: Float64Array, columns: Float64Array[], from: number, to: number): PeerPrediction {
  const expected = new Float64Array(to - from).fill(NaN);
  const deviation = new Float64Array(to - from).fill(NaN);
  for (let t = from; t < to; t++) {
    let e = fit.intercept;
    for (let j = 0; j < columns.length; j++) e += fit.coef[j]! * columns[j]![t]!;
    if (!Number.isFinite(e)) continue;
    expected[t - from] = e;
    const v = y[t]!;
    if (Number.isFinite(v)) deviation[t - from] = (v - e) / fit.sigma;
  }
  return { expected, deviation };
}

export function fitPeerModel(grid: Grid, sensorIndex: number, peers: Peer[], baseline: Window, masks: Masks): PeerModel {
  const alias = grid.aliases[sensorIndex]!;
  const y = maskedValues(grid, masks, sensorIndex);
  y.fill(NaN, 0, baseline.from);
  y.fill(NaN, baseline.to);
  const candidates = peers.filter((p) => p.alias !== alias && grid.aliases.includes(p.alias));
  const aligned = alignPeers(grid, masks, candidates);
  const kept: Peer[] = [];
  const columns: Float64Array[] = [];
  candidates.forEach((peer, j) => {
    const column = aligned[j]!;
    let count = 0;
    for (let t = baseline.from; t < baseline.to; t++) if (Number.isFinite(column[t]) && Number.isFinite(y[t])) count++;
    if (count >= 100) {
      kept.push(peer);
      columns.push(column);
    }
  });
  const fit = fitColumns(y, columns, stepSize(y));
  return {
    ...fit,
    sensor: alias,
    peers: kept,
    predict(g, m) {
      return predictRange(fit, maskedValues(g, m, g.aliases.indexOf(alias)), alignPeers(g, m, kept), 0, g.n);
    },
  };
}
