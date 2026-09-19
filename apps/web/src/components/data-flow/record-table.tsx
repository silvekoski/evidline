import { StatusBadge } from "@/components/status-badge";
import { formatTimeSeconds } from "@/lib/format";
import { useMemo, useState } from "react";
import { createColumnHelper, getCoreRowModel, getSortedRowModel, useReactTable, type SortingState } from "@tanstack/react-table";
import { PenLineIcon } from "lucide-react";
import type { EgressRecord } from "@tpm/schemas";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/data-table";
import { InferenceLink } from "@/components/inference-link";
import { screenForPurpose } from "@/layout/screens";
import { GuardMarks } from "./record-badges";

const column = createColumnHelper<EgressRecord>();

const linkClass = "rounded-sm font-mono text-xs underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";

export function RecordTable({ records, current, onOpen }: { records: EgressRecord[]; current: string | null; onOpen: (id: string) => void }) {
  const [sorting, setSorting] = useState<SortingState>([{ id: "time", desc: true }]);
  const columns = useMemo(
    () => [
      column.accessor("time", {
        header: "Time",
        cell: ({ getValue, row }) => (
          <button
            type="button"
            className={linkClass}
            onClick={(event) => {
              event.stopPropagation();
              onOpen(row.original.id);
            }}
            aria-label={`Open record ${row.original.id}`}
          >
            <time dateTime={getValue()}>{formatTimeSeconds(getValue())}</time>
          </button>
        ),
      }),
      column.accessor("purpose", {
        header: "Purpose",
        cell: ({ getValue, row }) => (
          <span className="inline-flex items-center gap-2 font-mono text-xs">
            {getValue()}
            {row.original.operatorText && (
              <Badge variant="outline" className="font-sans font-normal">
                <PenLineIcon aria-hidden="true" />
                operator text
              </Badge>
            )}
          </span>
        ),
      }),
      column.accessor("mode", { header: "Mode" }),
      column.accessor("status", { header: "Status", cell: ({ getValue }) => <StatusBadge kind={getValue()} /> }),
      column.accessor("payloadBytes", { header: "Bytes", meta: { numeric: true }, cell: ({ getValue }) => getValue().toLocaleString("en-US") }),
      column.accessor((record) => record.guards.filter((g) => !g.pass).length, {
        id: "guards",
        header: "Guards",
        cell: ({ row }) => <GuardMarks guards={row.original.guards} />,
      }),
      column.accessor("inferenceId", {
        header: "Inference",
        sortUndefined: "last",
        cell: ({ row }) => <InferenceLink runId={row.original.runId} id={row.original.inferenceId} screen={screenForPurpose[row.original.purpose]} className={linkClass} />,
      }),
    ],
    [onOpen],
  );
  const table = useReactTable({
    data: records,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getRowId: (record) => record.id,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <DataTable
      table={table}
      label="Data-flow records"
      empty="No model call yet. The gateway writes one record per call, in every mode."
      rowProps={(row) => ({
        id: row.original.id,
        "data-state": row.original.id === current ? "selected" : undefined,
        className: "cursor-pointer",
        onClick: () => onOpen(row.original.id),
      })}
    />
  );
}
