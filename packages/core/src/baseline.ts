import type { BaselineValue, Fingerprint } from "@tpm/schemas";
import { median } from "./stats/quantile";
import { binarySegmentation } from "./stats/segmentation";
import { roundSig } from "./stats/series";
import { type EvidenceSink, type Grid, window } from "./types";

export type BaselineResult = { value: BaselineValue; claim: string; confidence: number; evidenceIds: string[] };

type Change = { sensor: number; index: number; move: number; scale: number };

type ChangeGroup = { index: number; sensors: number[]; big: Change | null };

export function selectBaseline(grid: Grid, fps: Fingerprint[], sink: EvidenceSink): BaselineResult {
  const { n, aliases, episodes } = grid;
  const evidenceIds: string[] = [];
  const changes: Change[] = [];
  const perSensor = aliases.map((alias, sensor) => {
    const x = grid.values[sensor]!;
    const cps = binarySegmentation(x, { episodes });
    if (cps.length === 0) return cps;
    const scale = Math.max(fps[sensor]!.mad, fps[sensor]!.noise);
    const edges = [0, ...cps, n];
    const levels = edges.slice(0, -1).map((from, k) => median(x.subarray(from, edges[k + 1]!)));
    let maxMove = 0;
    cps.forEach((index, k) => {
      const move = Math.abs(levels[k + 1]! - levels[k]!);
      maxMove = Math.max(maxMove, move);
      changes.push({ sensor, index, move, scale });
    });
    evidenceIds.push(
      sink.add({
        kind: "changepoint",
        sensors: [alias],
        window: window(0, n),
        method: "binary-segmentation",
        stats: { n, changepoints: cps.length, scale, maxMove },
        verdict: `${alias} has ${cps.length} change point${cps.length === 1 ? "" : "s"}, the first at sample ${cps[0]}.`,
        chart: {
          type: "line",
          window: window(0, n),
          series: [{ key: alias, label: alias, source: { sensor: alias }, style: "solid" }],
          marks: cps.map((at) => ({ at, label: `change at ${at}`, kind: "changepoint" })),
        },
      }),
    );
    return cps;
  });

  changes.sort((a, b) => a.index - b.index);
  const counted: ChangeGroup[] = [];
  for (let i = 0; i < changes.length; ) {
    const first = changes[i]!;
    const members = new Set<number>();
    let big: Change | null = null;
    let j = i;
    for (; j < changes.length && changes[j]!.index - first.index <= 0.01 * n; j++) {
      const c = changes[j]!;
      members.add(c.sensor);
      if (c.move > 3 * c.scale) big ??= c;
    }
    if (members.size >= 3 || big) counted.push({ index: first.index, sensors: [...members], big });
    i = j;
  }

  const minLength = Math.max(1000, Math.floor(0.1 * n));
  const starts = episodes.slice(1).map((e) => e.from);
  const snap = (end: number) => starts.filter((s) => s <= end && end - s <= 0.05 * n).at(-1) ?? end;
  let chosen: ChangeGroup | null = null;
  let end = snap(Math.floor(0.6 * n));
  for (const g of counted) {
    const snapped = snap(g.index);
    if (snapped >= minLength) {
      chosen = g;
      end = snapped;
      break;
    }
  }

  const clean = perSensor.filter((cps) => !cps.some((c) => c < end)).length;
  const shown = (chosen ? chosen.sensors : aliases.map((_, i) => i)).slice(0, 5);
  evidenceIds.push(
    sink.add({
      kind: "structure",
      sensors: aliases,
      window: window(0, end),
      method: "baseline-selection",
      stats: { n: end, changepoints: counted.length, cleanSensors: clean, sensors: aliases.length },
      verdict: `${clean} of ${aliases.length} sensors have no change point in the first ${end} samples.`,
      chart: {
        type: "line",
        window: window(0, n),
        series: shown.map((i) => ({
          key: aliases[i]!,
          label: aliases[i]!,
          source: { sensor: aliases[i]! },
          style: shown.length === 1 ? "solid" : "thin",
        })),
        marks: [{ at: end, label: `baseline end ${end}`, kind: "boundary" }],
      },
    }),
  );

  const reason = chosen
    ? chosen.sensors.length >= 3
      ? `The first counted change point at sample ${chosen.index} is shared by ${chosen.sensors.length} sensors.`
      : `The first counted change point at sample ${chosen.index} moves ${aliases[chosen.big!.sensor]} by ${roundSig(chosen.big!.move)}, more than 3 change point scales.`
    : counted.length === 0
      ? "No change point counts, so the baseline is the first 60% of the grid."
      : `Each counted change point lies before the minimum length of ${minLength} samples, so the baseline is the first 60% of the grid.`;
  const snappedToBoundary = end !== (chosen ? chosen.index : Math.floor(0.6 * n));
  return {
    value: { window: window(0, end), changepoints: counted.map((g) => g.index) },
    claim: `Baseline is the first ${end} samples. ${reason}${snappedToBoundary ? ` The end snaps to the episode boundary at sample ${end}.` : ""}`,
    confidence: aliases.length > 0 ? clean / aliases.length : 1,
    evidenceIds,
  };
}
