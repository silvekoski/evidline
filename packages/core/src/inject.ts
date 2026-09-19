import type { Rng } from "./random";
import { rollingMedian } from "./stats/hampel";
import { mad } from "./stats/quantile";
import { stepSize } from "./stats/series";

export type FaultKind = "bias" | "gain" | "dead" | "spikes" | "noise" | "dropout" | "step" | "resolution";

export type FaultSpec = { kind: FaultKind; from: number; to?: number; magnitude: number };

export function injectFault(x: Float64Array, spec: FaultSpec, rng: Rng): Float64Array {
  const y = x.slice();
  const from = Math.max(0, spec.from);
  const to = Math.min(x.length, spec.to ?? x.length);
  if (to <= from) return y;
  const span = Math.max(1, to - 1 - from);
  const { magnitude } = spec;
  switch (spec.kind) {
    case "bias":
      for (let t = from; t < to; t++) y[t] = x[t]! + (magnitude * (t - from)) / span;
      break;
    case "gain":
      for (let t = from; t < to; t++) y[t] = x[t]! * (1 + ((magnitude - 1) * (t - from)) / span);
      break;
    case "step":
      for (let t = from; t < to; t++) y[t] = x[t]! + magnitude;
      break;
    case "dead": {
      const held = x.subarray(from, to).find(Number.isFinite);
      if (held !== undefined) y.fill(held, from, to);
      break;
    }
    case "spikes": {
      const sigma = mad(x.subarray(from, to));
      for (let t = from, sign = 1; t < to; t += 50, sign = -sign) y[t] = x[t]! + sign * magnitude * sigma;
      break;
    }
    case "noise": {
      const m = rollingMedian(x, 7);
      for (let t = from; t < to; t++) y[t] = m[t]! + magnitude * (x[t]! - m[t]!);
      break;
    }
    case "dropout":
      for (let t = from; t < to; t++) if (rng() < magnitude) y[t] = NaN;
      break;
    case "resolution": {
      const q = magnitude * stepSize(x);
      if (q > 0) for (let t = from; t < to; t++) y[t] = Math.round(x[t]! / q) * q;
      break;
    }
  }
  return y;
}
