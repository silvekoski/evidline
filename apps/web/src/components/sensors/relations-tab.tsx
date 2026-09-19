import { useMemo, useState } from "react";
import { useQueries, type UseQueryResult } from "@tanstack/react-query";
import { createColumnHelper, getCoreRowModel, getSortedRowModel, useReactTable, type SortingState } from "@tanstack/react-table";
import type { Evidence, Lens, Relation, SensorDetail, SensorReport } from "@tpm/schemas";
import { getEvidence, keys } from "@/api";
import { EvidenceChip } from "@/components/evidence-chip";
import { formatNumber } from "@/lib/format";
import { AliasChip } from "./alias-chip";
import { DataTable } from "@/components/data-table";
import { formatDuration } from "./duration";

type Row = { peer: string; rho: number; lag: number; rhoAtLag: number; direction: string; evidenceId: string; lagEvidenceId: string | null };

const column = createColumnHelper<Row>();

const columns = [
  column.accessor("peer", {
    header: "Peer",
    cell: ({ getValue }) => <AliasChip alias={getValue()} />,
  }),
  column.accessor("rho", {
    header: "rho",
    cell: ({ getValue }) => formatNumber(getValue()),
    sortingFn: (a, b) => Math.abs(a.original.rho) - Math.abs(b.original.rho),
    meta: { numeric: true },
  }),
  column.accessor("lag", { header: "Lag", meta: { numeric: true } }),
  column.accessor("direction", { header: "Direction", enableSorting: false }),
  column.accessor("rhoAtLag", {
    header: "rho at lag",
    cell: ({ getValue }) => formatNumber(getValue()),
    meta: { numeric: true },
  }),
  column.display({
    id: "evidence",
    header: "Evidence",
    cell: ({ row }) => (
      <span className="inline-flex flex-wrap gap-1">
        <EvidenceChip evidenceId={row.original.evidenceId} />
        {row.original.lagEvidenceId && <EvidenceChip evidenceId={row.original.lagEvidenceId} />}
      </span>
    ),
  }),
];

const lagEdges = (results: UseQueryResult<Evidence>[]) => results.flatMap((r) => (r.data?.kind === "lag" ? [{ id: r.data.id, sensors: r.data.sensors }] : []));

function describe(rel: Relation, self: string, dt: number | null): Omit<Row, "lagEvidenceId"> {
  const peer = rel.a === self ? rel.b : rel.a;
  const lag = rel.a === self ? rel.lag : -rel.lag;
  const timing = lag === 0 ? "same time" : `${lag > 0 ? "leads" : "follows"} by ${formatDuration(Math.abs(lag), dt)}`;
  return { peer, rho: rel.rho, lag, rhoAtLag: rel.rhoAtLag, direction: rel.rho < 0 ? `${timing}, inverse` : timing, evidenceId: rel.evidenceId };
}

export function RelationsTab({ detail, report, lens, dt }: { detail: SensorDetail; report: SensorReport; lens: Lens; dt: number | null }) {
  const relationIds = new Set(detail.relations.map((r) => r.evidenceId));
  const otherIds = detail.evidenceIds.filter((id) => !relationIds.has(id));
  const edges = useQueries({ queries: otherIds.map((id) => ({ queryKey: keys.evidence(id), queryFn: () => getEvidence(id) })), combine: lagEdges });
  const rows = useMemo(
    () =>
      detail.relations.map((rel) => {
        const row = describe(rel, detail.alias, dt);
        return { ...row, lagEvidenceId: edges.find((e) => e.sensors.includes(row.peer))?.id ?? null };
      }),
    [detail, dt, edges],
  );
  const [sorting, setSorting] = useState<SortingState>([{ id: "rho", desc: true }]);
  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });
  const group = report.redundancyGroups.find((g) => g.sensors.includes(detail.alias));

  return (
    <div className="flex flex-col gap-5">
      <section aria-labelledby="redundancy-group" className="flex flex-col gap-2">
        <h3 id="redundancy-group" className="text-xs font-medium text-muted-foreground">
          Redundancy group
        </h3>
        {group ? (
          <>
            <div className="flex flex-wrap items-center gap-1">
              {group.sensors.map((alias) => (
                <AliasChip key={alias} alias={alias} current={alias === detail.alias} />
              ))}
              <EvidenceChip evidenceId={group.evidenceId} className="ml-1" />
            </div>
            <p className="text-xs text-muted-foreground">
              These {lens.sensors} agree above the redundancy threshold at lag zero. They measure the same quantity.
            </p>
          </>
        ) : (
          <p className="text-muted-foreground">Not in a group. No other {lens.sensor} agrees with {detail.alias} above the redundancy threshold.</p>
        )}
      </section>
      <section aria-labelledby="top-relations" className="flex flex-col gap-2">
        <h3 id="top-relations" className="text-xs font-medium text-muted-foreground">
          Relations, strongest first
        </h3>
        <DataTable label="Sensor relations" table={table} empty={`No relation above the correlation threshold for ${detail.alias}.`} />
        <p className="text-xs text-muted-foreground">
          rho is the Spearman correlation on the healthy baseline. A positive lag means {detail.alias} leads the peer. Inverse means the two move in opposite directions. rho at lag is the
          cross-correlation at that lag.
        </p>
      </section>
    </div>
  );
}
