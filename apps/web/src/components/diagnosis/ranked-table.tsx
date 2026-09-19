import { useMemo } from "react";
import { createColumnHelper } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table";
import { Link } from "react-router";
import type { RankedSensor } from "@tpm/schemas";
import { useLens } from "@/hooks/use-lens";
import { screenPath } from "@/layout/screens";
import { Progress } from "@/components/ui/progress";
import { formatNumber } from "@/lib/format";

type Row = RankedSensor & { rank: number };

const column = createColumnHelper<Row>();
const right = { numeric: true };

export function RankedTable({
  ranked,
  runId,
  current,
  label,
}: {
  ranked: RankedSensor[];
  runId: string;
  current: string | null;
  label: (sample: number) => string;
}) {
  const lens = useLens();
  const data = useMemo(() => ranked.map((r, i) => ({ ...r, rank: i + 1 })), [ranked]);
  const columns = useMemo(
    () => [
      column.accessor("rank", { header: "Rank", meta: right }),
      column.accessor("sensor", {
        header: "Alias",
        cell: ({ getValue }) => (
          <Link to={screenPath(runId, "sensors", getValue())} className="font-mono underline-offset-4 hover:underline">
            {getValue()}
          </Link>
        ),
      }),
      column.accessor("contribution", {
        header: "Contribution",
        meta: right,
        cell: ({ getValue, row }) => (
          <span className="inline-flex items-center justify-end gap-2">
            <Progress
              value={getValue() * 100}
              aria-valuenow={getValue() * 100}
              aria-valuetext={formatNumber(getValue())}
              aria-label={`${row.original.sensor} contribution`}
              className="w-24"
            />
            <span className="w-12">{formatNumber(getValue())}</span>
          </span>
        ),
      }),
      column.accessor((row) => row.onset ?? undefined, {
        id: "onset",
        header: "Onset",
        meta: right,
        sortUndefined: "last",
        cell: ({ getValue }) => {
          const onset = getValue();
          return onset === undefined ? null : <span title={`sample ${onset}`}>{label(onset)}</span>;
        },
      }),
    ],
    [runId, label],
  );
  return (
    <DataTable
      data={data}
      columns={columns}
      label="Ranked sensors"
      initialSorting={[{ id: "contribution", desc: true }]}
      getRowId={(row) => row.sensor}
      empty={`No ranked ${lens.sensor}. The health gate masked every candidate.`}
      rowProps={(row) => ({ "data-state": row.original.sensor === current ? "selected" : undefined })}
    />
  );
}
