export type EmbedKind = "passage" | "query";

export type Embedder = {
  name: string;
  model: string;
  host: string | null;
  dims: number;
  embed(texts: string[], kind: EmbedKind): Promise<Float32Array[]>;
};

export function normalize(vector: Float32Array): Float32Array {
  let sum = 0;
  for (const v of vector) sum += v * v;
  const norm = Math.sqrt(sum);
  if (norm === 0) return vector;
  for (let i = 0; i < vector.length; i++) vector[i] = vector[i]! / norm;
  return vector;
}
