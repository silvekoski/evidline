import { mulberry32 } from "../random";
import { median } from "./quantile";

export function theilSen(y: Float64Array, x?: Float64Array): { slope: number; intercept: number } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < y.length; i++) {
    const yi = y[i]!;
    const xi = x ? x[i]! : i;
    if (Number.isFinite(yi) && Number.isFinite(xi)) {
      xs.push(xi);
      ys.push(yi);
    }
  }
  const n = xs.length;
  if (n === 0) return { slope: 0, intercept: 0 };
  const slopes: number[] = [];
  const pair = (i: number, j: number) => {
    const dx = xs[j]! - xs[i]!;
    if (dx !== 0) slopes.push((ys[j]! - ys[i]!) / dx);
  };
  if (n <= 1500) {
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) pair(i, j);
  } else {
    const rng = mulberry32(1);
    for (let s = 0; s < 200000; s++) pair(Math.floor(rng() * n), Math.floor(rng() * n));
  }
  const slope = slopes.length > 0 ? median(Float64Array.from(slopes)) : 0;
  const intercept = median(Float64Array.from(ys, (v, i) => v - slope * xs[i]!));
  return { slope, intercept };
}

function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r =
    t *
    Math.exp(
      -z * z -
        1.26551223 +
        t *
          (1.00002368 +
            t *
              (0.37409196 +
                t *
                  (0.09678418 +
                    t *
                      (-0.18628806 +
                        t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))),
    );
  return x >= 0 ? r : 2 - r;
}

export function mannKendall(y: Float64Array): { s: number; z: number; p: number } {
  const v: number[] = [];
  for (const u of y) if (Number.isFinite(u)) v.push(u);
  const n = v.length;
  if (n < 3) return { s: 0, z: 0, p: 1 };
  let s = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) s += Math.sign(v[j]! - v[i]!);
  const sorted = [...v].sort((a, b) => a - b);
  let ties = 0;
  let run = 1;
  for (let i = 1; i <= n; i++) {
    if (i < n && sorted[i] === sorted[i - 1]) {
      run++;
      continue;
    }
    if (run > 1) ties += run * (run - 1) * (2 * run + 5);
    run = 1;
  }
  const variance = (n * (n - 1) * (2 * n + 5) - ties) / 18;
  if (variance <= 0) return { s, z: 0, p: 1 };
  const z = s > 0 ? (s - 1) / Math.sqrt(variance) : s < 0 ? (s + 1) / Math.sqrt(variance) : 0;
  return { s, z, p: erfc(Math.abs(z) / Math.SQRT2) };
}
