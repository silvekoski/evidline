import { Matrix, solve } from "ml-matrix";
import { mad } from "./quantile";

export type RobustRegression = { coef: number[]; intercept: number; sigma: number; residuals: Float64Array; n: number };

export function robustRegression(
  X: Float64Array[],
  y: Float64Array,
  opts: { iterations?: number; huberC?: number } = {},
): RobustRegression {
  const iterations = opts.iterations ?? 5;
  const c = opts.huberC ?? 1.345;
  const dim = X.length + 1;
  const rows: number[] = [];
  for (let t = 0; t < y.length; t++) {
    if (Number.isFinite(y[t]) && X.every((col) => Number.isFinite(col[t]))) rows.push(t);
  }
  const m = rows.length;
  const design = new Float64Array(m * dim);
  const target = new Float64Array(m);
  for (let r = 0; r < m; r++) {
    const t = rows[r]!;
    design[r * dim] = 1;
    for (let j = 1; j < dim; j++) design[r * dim + j] = X[j - 1]![t]!;
    target[r] = y[t]!;
  }
  const weights = new Float64Array(m).fill(1);
  const rowResiduals = new Float64Array(m);
  let beta = new Float64Array(dim);
  let sigma = 0;

  const fit = () => {
    const A = new Float64Array(dim * dim);
    const b = new Float64Array(dim);
    for (let r = 0; r < m; r++) {
      const base = r * dim;
      const w = weights[r]!;
      for (let i = 0; i < dim; i++) {
        const wi = w * design[base + i]!;
        b[i] = b[i]! + wi * target[r]!;
        for (let j = i; j < dim; j++) A[i * dim + j] = A[i * dim + j]! + wi * design[base + j]!;
      }
    }
    const lhs = new Matrix(dim, dim);
    for (let i = 0; i < dim; i++) {
      for (let j = i; j < dim; j++) {
        const v = A[i * dim + j]! + (i === j ? 1e-8 : 0);
        lhs.set(i, j, v);
        lhs.set(j, i, v);
      }
    }
    const solved = solve(lhs, Matrix.columnVector(Array.from(b)), true).to1DArray();
    if (solved.every(Number.isFinite)) beta = Float64Array.from(solved);
    for (let r = 0; r < m; r++) {
      const base = r * dim;
      let yhat = 0;
      for (let j = 0; j < dim; j++) yhat += beta[j]! * design[base + j]!;
      rowResiduals[r] = target[r]! - yhat;
    }
    sigma = m > 0 ? mad(rowResiduals) : 0;
  };

  fit();
  for (let it = 0; it < iterations && sigma > 0; it++) {
    for (let r = 0; r < m; r++) {
      const u = Math.abs(rowResiduals[r]!) / sigma;
      weights[r] = u > c ? c / u : 1;
    }
    fit();
  }
  const residuals = new Float64Array(y.length).fill(NaN);
  for (let r = 0; r < m; r++) residuals[rows[r]!] = rowResiduals[r]!;
  return { coef: Array.from(beta.subarray(1)), intercept: beta[0]!, sigma, residuals, n: m };
}
