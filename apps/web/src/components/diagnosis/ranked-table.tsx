import { useMemo, useState } from "react";
import { createColumnHelper } from "@tanstack/react-table";
import { Link } from "react-router";
import type { RankedSensor } from "@tpm/schemas";
import { useLens } from "@/hooks/use-lens";
import { screenPath } from "@/layout/screens";
import { DataTable } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { capitalize, formatNumber } from "@/lib/format";

type Row = RankedSensor & { rank: number };

const column = createColumnHelper<Row>();
const right = { numeric: true };
const top = 5;

export function RankedTable({
  ranked,
  runId,
  highlight,
  label,
}: {
  ranked: RankedSensor[];
  runId: string;
  highlight: string | null;
  label: (sample: number) => string;
}) {
  const lens = useLens();
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const all = expanded ?? ranked.findIndex((r) => r.sensor === highlight) >= top;
  const data = useMemo(() => ranked.map((r, i) => ({ ...r, rank: i + 1 })).slice(0, all ? undefined : top), [ranked, all]);
  const onsets = ranked.flatMap((r) => (r.onset === null ? [] : [r.onset]));
  const first = Math.min(...onsets);
  const span = Math.max(...onsets) - first;
  const columns = useMemo(
    () => [
      column.accessor("rank", { header: "Rank", meta: right, enableSorting: false }),
      column.accessor("sensor", {
        header: capitalize(lens.sensor),
        enableSorting: false,
        cell: ({ getValue }) => (
          <Link to={screenPath(runId, "sensors", getValue())} className="font-mono underline-offset-4 hover:underline">
            {getValue()}
          </Link>
        ),
      }),
      column.accessor("contribution", {
        header: "Contribution",
        meta: right,
        enableSorting: false,
        cell: ({ getValue, row }) => (
          <span className="flex items-center justify-end gap-2">
            <Progress
              value={getValue() * 100}
              aria-valuenow={getValue() * 100}
              aria-valuetext={formatNumber(getValue())}
              aria-label={`${row.original.sensor} contribution`}
              className="w-20 md:w-28"
            />
            <span className="w-12">{formatNumber(getValue())}</span>
          </span>
        ),
      }),
      column.accessor("onset", {
        header: "Onset",
        meta: right,
        enableSorting: false,
        cell: ({ getValue }) => {
          const onset = getValue();
          if (onset === null) return null;
          return (
            <span className="flex items-center justify-end gap-2">
              <span aria-hidden="true" className="relative h-2 w-16 rounded-xs bg-muted md:w-28">
                <span className="absolute inset-y-0 size-2 rounded-full bg-foreground" style={{ left: `calc(${span === 0 ? 0 : (onset - first) / span} * (100% - 0.5rem))` }} />
              </span>
              <span title={`sample ${onset}`}>{label(onset)}</span>
            </span>
          );
        },
      }),
    ],
    [runId, label, lens.sensor, first, span],
  );
  return (
    <div className="flex flex-col items-start gap-1">
      <DataTable
        data={data}
        columns={columns}
        label={`Ranked ${lens.sensors}`}
        getRowId={(row) => row.sensor}
        rowProps={(row) => (row.original.sensor === highlight ? { "data-state": "selected", "aria-current": "true" } : {})}
      />
      {ranked.length > top && (
        <Button variant="ghost" size="xs" aria-expanded={all} onClick={() => setExpanded(!all)}>
          {all ? `Show top ${top}` : `Show all ${ranked.length}`}
        </Button>
      )}
    </div>
  );
}
