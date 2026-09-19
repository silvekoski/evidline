import { useMemo } from "react";
import type { ColumnDef, ExpandedState, OnChangeFn } from "@tanstack/react-table";
import { CircleIcon, CircleOffIcon } from "lucide-react";
import { HealthClass, faultLabel, healthToFault, type HealthInference, type HealthValue } from "@tpm/schemas";
import { ActionBar } from "@/components/action-bar";
import { ConfidenceBar } from "@/components/confidence-bar";
import { StatusBadge, healthKind } from "@/components/status-badge";
import { useLens } from "@/hooks/use-lens";
import { capitalize, formatNumber } from "@/lib/format";
import { DataTable, expandColumn } from "./data-table";
import { EvidenceChips } from "./inference-footer";
import { SampleRange, type DayLabel } from "./sample-range";

type Check = HealthValue["checks"][number];

const healthRank = (health: HealthValue["health"]) => (health === "healthy" ? HealthClass.options.length : HealthClass.options.indexOf(health));
const failedCheck = (h: HealthInference) => h.value.checks.find((c) => c.check === h.value.health);
const optionalNumber = (x: number | undefined) => (x === undefined ? null : formatNumber(x));

const checkColumns: ColumnDef<Check>[] = [
  { accessorKey: "check", header: "Check", cell: ({ row }) => <span className="font-mono">{row.original.check}</span> },
  {
    id: "result",
    accessorFn: (c) => (c.pass ? 1 : 0),
    header: "Result",
    cell: ({ row }) =>
      row.original.pass ? (
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <CircleIcon className="size-3.5" aria-hidden="true" />
          pass
        </span>
      ) : (
        <span className="inline-flex items-center gap-1">
          <CircleOffIcon className="size-3.5" aria-hidden="true" />
          fail
        </span>
      ),
  },
  { accessorKey: "statistic", header: "Statistic", meta: { numeric: true }, cell: ({ row }) => formatNumber(row.original.statistic) },
  { accessorKey: "threshold", header: "Threshold", meta: { numeric: true }, cell: ({ row }) => formatNumber(row.original.threshold) },
  {
    id: "ratio",
    accessorFn: (c) => (c.threshold === 0 ? 1 : c.statistic / c.threshold),
    header: "Ratio",
    meta: { numeric: true },
    cell: ({ getValue }) => formatNumber(getValue<number>()),
  },
];

export function HealthTable({
  checks,
  day,
  expanded,
  onExpandedChange,
  targetId,
}: {
  checks: HealthInference[];
  day: DayLabel;
  expanded: ExpandedState;
  onExpandedChange: OnChangeFn<ExpandedState>;
  targetId: string | null;
}) {
  const lens = useLens();
  const columns = useMemo<ColumnDef<HealthInference>[]>(
    () => [
      expandColumn((h) => `Checks of ${h.value.sensor}`),
      { id: "sensor", accessorFn: (h) => h.value.sensor, header: capitalize(lens.sensor), cell: ({ row }) => <span className="font-mono">{row.original.value.sensor}</span> },
      {
        id: "health",
        accessorFn: (h) => healthRank(h.value.health),
        header: "Health",
        cell: ({ row }) => {
          const health = row.original.value.health;
          return <StatusBadge kind={healthKind(health)} label={health === "healthy" ? undefined : faultLabel(healthToFault(health))} />;
        },
      },
      {
        id: "check",
        accessorFn: (h) => failedCheck(h)?.check,
        header: "Failed check",
        sortUndefined: "last",
        cell: ({ getValue }) => <span className="font-mono">{getValue<string | undefined>() ?? ""}</span>,
      },
      {
        id: "statistic",
        accessorFn: (h) => failedCheck(h)?.statistic,
        header: "Statistic",
        meta: { numeric: true },
        sortUndefined: "last",
        cell: ({ getValue }) => optionalNumber(getValue<number | undefined>()),
      },
      {
        id: "threshold",
        accessorFn: (h) => failedCheck(h)?.threshold,
        header: "Threshold",
        meta: { numeric: true },
        sortUndefined: "last",
        cell: ({ getValue }) => optionalNumber(getValue<number | undefined>()),
      },
      {
        id: "masked",
        accessorFn: (h) => h.value.masked.reduce((sum, w) => sum + w.n, 0),
        header: "Masked windows",
        meta: { className: "whitespace-normal" },
        cell: ({ row }) => {
          const masked = row.original.value.masked;
          const shown = masked.slice(0, 3);
          return (
            <span className="flex flex-col">
              {shown.map((w) => (
                <SampleRange key={`${w.from}-${w.to}`} window={w} day={day} />
              ))}
              {masked.length > shown.length && <span className="text-xs text-muted-foreground">and {masked.length - shown.length} more</span>}
            </span>
          );
        },
      },
      { id: "confidence", accessorFn: (h) => h.confidence, header: "Confidence", cell: ({ row }) => <ConfidenceBar value={row.original.confidence} /> },
      {
        id: "evidence",
        header: "Evidence",
        enableSorting: false,
        meta: { className: "whitespace-normal" },
        cell: ({ row }) => <EvidenceChips ids={row.original.evidenceIds} />,
      },
      { id: "status", accessorFn: (h) => h.status, header: "Status", cell: ({ row }) => <StatusBadge kind={row.original.status} /> },
    ],
    [lens.sensor, day],
  );

  return (
    <DataTable
      label={`Health checks per ${lens.sensor}`}
      columns={columns}
      data={checks}
      getRowId={(h) => h.id}
      initialSorting={[{ id: "health", desc: false }]}
      expanded={expanded}
      onExpandedChange={onExpandedChange}
      rowProps={(row) => ({ id: row.id, tabIndex: row.id === targetId ? -1 : undefined, "data-state": row.id === targetId ? "selected" : undefined })}
      renderExpanded={(row) => (
        <div className="flex flex-col gap-3">
          <p>{row.original.claim}</p>
          <DataTable label={`Checks of ${row.original.value.sensor}`} columns={checkColumns} data={row.original.value.checks} getRowId={(c) => c.check} />
          <ActionBar inference={row.original} />
        </div>
      )}
      empty="No health inferences for this run."
    />
  );
}
