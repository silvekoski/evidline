import { streamRows } from "./csv";
import { GridBuilder, aliases } from "./grid-builder";
import { parseNumber, plainDecimal } from "./parse-number";
import { parseTime } from "./parse-time";
import type { LoadContext, Source } from "./types";

export async function loadStream(ctx: LoadContext): Promise<Source> {
  const { header, profiles, sample, delimiter } = ctx;
  const { timeColumn, counterColumn } = ctx.layout;
  const timeUnit = timeColumn === null ? null : (profiles[timeColumn]?.timeUnit ?? null);
  const isSensorCandidate = (i: number): boolean => profiles[i]?.numeric === true && i !== timeColumn && i !== counterColumn;
  const candidates = header.flatMap((_, i) => (isSensorCandidate(i) ? [i] : []));
  const fast = sample.every((row) =>
    row.every((cell, i) => {
      if (cell.includes('"') || cell.includes(delimiter) || cell.includes("\n") || cell.includes("\r")) return false;
      return !profiles[i]?.numeric || cell === "" || plainDecimal.test(cell);
    }),
  );
  const parseCell = fast
    ? (cell: string | undefined): number => {
        const v = cell ? Number(cell) : NaN;
        return Number.isFinite(v) ? v : NaN;
      }
    : (cell: string | undefined): number => (cell === undefined ? NaN : parseNumber(cell));

  const builder = new GridBuilder(candidates.length, ctx.maxGrid);
  const values = new Float64Array(candidates.length);
  const episodeFirst = new Float64Array(candidates.length).fill(NaN);
  const varies = new Uint8Array(candidates.length);
  let previousCount = NaN;
  await streamRows(
    ctx.path,
    { delimiter, fast },
    (cells) => {
      if (counterColumn !== null) {
        const count = parseCell(cells[counterColumn]);
        if (!Number.isNaN(count)) {
          if (count <= previousCount) {
            builder.startEpisode();
            episodeFirst.fill(NaN);
          }
          previousCount = count;
        }
      }
      for (let k = 0; k < candidates.length; k++) {
        const v = parseCell(cells[candidates[k] ?? -1]);
        values[k] = v;
        if (Number.isNaN(v) || varies[k] === 1) continue;
        const first = episodeFirst[k] ?? NaN;
        if (Number.isNaN(first)) episodeFirst[k] = v;
        else if (v !== first) varies[k] = 1;
      }
      builder.push(values, timeUnit === null ? NaN : parseTime(cells[timeColumn ?? -1] ?? "", timeUnit));
    },
    ctx.onProgress,
  );

  const built = builder.finish(timeUnit !== null);
  const kept = candidates.flatMap((_, k) => (varies[k] === 1 ? [k] : []));
  const constant = new Set(candidates.filter((_, k) => varies[k] !== 1));
  const quarantined = header.filter((_, i) => i !== timeColumn && i !== counterColumn && (!profiles[i]?.numeric || constant.has(i)));
  const medianStep = timeColumn === null ? NaN : (profiles[timeColumn]?.medianStep ?? NaN);
  const t0 = built.time?.find((t) => !Number.isNaN(t)) ?? null;
  return {
    grid: {
      aliases: aliases(kept.length),
      values: kept.map((k) => built.values[k] as Float64Array),
      n: built.n,
      dt: medianStep > 0 ? medianStep * built.bucket : null,
      time: built.time,
      episodes: built.episodes,
    },
    t0,
    sourceNames: kept.map((k) => header[candidates[k] ?? -1] ?? ""),
    stats: {
      rows: built.rows,
      columns: header.length,
      rawBytes: ctx.rawBytes,
      quarantined,
      domain: "stream",
      bucket: built.bucket,
      episodes: built.episodes.length,
    },
  };
}
