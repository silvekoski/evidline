import type { Window } from "@tpm/schemas";

const W = 600;
const H = 40;

export type LaneScale = { t: number[]; gridSize: number; changepoints: number[]; baselineTo: number };

const x = (sample: number, gridSize: number) => (sample / gridSize) * W;

function signalPath(scale: LaneScale, values: (number | null)[], lo: number, hi: number): string {
  const span = hi - lo || 1;
  const y = (v: number) => H - 3 - ((v - lo) / span) * (H - 6);
  let d = "";
  let pen = false;
  for (let i = 0; i < scale.t.length; i++) {
    const v = values[i];
    if (v === null || v === undefined) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${x(scale.t[i]!, scale.gridSize).toFixed(1)} ${y(v).toFixed(1)}`;
    pen = true;
  }
  return d;
}

export function maskShare(masks: Window[], gridSize: number): number {
  const sorted = [...masks].sort((a, b) => a.from - b.from);
  let covered = 0;
  let end = 0;
  for (const m of sorted) {
    const from = Math.max(m.from, end);
    if (m.to > from) covered += m.to - from;
    end = Math.max(end, m.to);
  }
  return gridSize === 0 ? 0 : covered / gridSize;
}

export const percent = (share: number) => `${(share * 100).toFixed(share * 100 < 10 && share > 0 ? 1 : 0)} %`;

function Marks({ scale }: { scale: LaneScale }) {
  return (
    <>
      <rect x={0} y={0} width={x(scale.baselineTo, scale.gridSize)} height={H} className="fill-chart-1/15" />
      {scale.changepoints.map((cp) => (
        <line key={cp} x1={x(cp, scale.gridSize)} x2={x(cp, scale.gridSize)} y1={0} y2={H} className="stroke-muted-foreground/60" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
      ))}
    </>
  );
}

export function SignalLane({
  scale,
  values,
  band,
  masks,
  label,
  description,
}: {
  scale: LaneScale;
  values: (number | null)[] | undefined;
  band: { lo: number; hi: number } | null | undefined;
  masks: Window[];
  label: (sample: number) => string;
  description: string;
}) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values ?? []) {
    if (v === null) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (band) {
    lo = Math.min(lo, band.lo);
    hi = Math.max(hi, band.hi);
  }
  if (!Number.isFinite(lo)) {
    lo = 0;
    hi = 1;
  }
  const pad = (hi - lo || 1) * 0.12;
  lo -= pad;
  hi += pad;
  const y = (v: number) => H - 3 - ((v - lo) / (hi - lo)) * (H - 6);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-10 w-full min-w-40" role="img" aria-label={description}>
      <Marks scale={scale} />
      {band && <rect x={0} y={y(band.hi)} width={W} height={Math.max(1, y(band.lo) - y(band.hi))} className="fill-chart-1/20" />}
      {masks.map((m) => (
        <rect key={`${m.from}-${m.to}`} x={x(m.from, scale.gridSize)} y={0} width={Math.max(1, x(m.to, scale.gridSize) - x(m.from, scale.gridSize))} height={H} className="fill-chart-2/30">
          <title>{`Masked ${label(m.from)} to ${label(m.to)}, ${m.n.toLocaleString("en-US")} samples, ${percent(m.n / scale.gridSize)} of the run`}</title>
        </rect>
      ))}
      {values && <path d={signalPath(scale, values, lo, hi)} fill="none" className="stroke-foreground" strokeWidth={1.1} vectorEffect="non-scaling-stroke" />}
    </svg>
  );
}

export function DensityLane({ scale, rows, description }: { scale: LaneScale; rows: Window[][]; description: string }) {
  const counts = scale.t.map((sample) => rows.filter((masks) => masks.some((m) => sample >= m.from && sample < m.to)).length);
  const runs: { from: number; to: number; count: number }[] = [];
  counts.forEach((count, i) => {
    const last = runs.at(-1);
    if (last && last.count === count) last.to = i + 1;
    else runs.push({ from: i, to: i + 1, count });
  });
  const bucket = scale.t[1] ?? scale.gridSize;
  return (
    <svg viewBox={`0 0 ${W} 6`} preserveAspectRatio="none" className="block h-1.5 w-full min-w-40" role="img" aria-label={description}>
      {runs
        .filter((r) => r.count > 0)
        .map((r) => (
          <rect key={r.from} x={x(r.from * bucket, scale.gridSize)} y={0} width={x((r.to - r.from) * bucket, scale.gridSize)} height={6} className="fill-chart-2" opacity={0.25 + 0.75 * (r.count / rows.length)} />
        ))}
    </svg>
  );
}
