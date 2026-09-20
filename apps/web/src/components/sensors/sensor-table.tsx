import { useMemo, useState } from "react";
import {
  createColumnHelper,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnFiltersState,
  type SortingState,
} from "@tanstack/react-table";
import { SearchIcon } from "lucide-react";
import { HealthClass, Role, type Lens, type SensorRow } from "@tpm/schemas";
import { ConfidenceBar } from "@/components/confidence-bar";
import { StatusBadge } from "@/components/status-badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable } from "@/components/data-table";
import { HealthBadge } from "./health-badge";
import { NameCheckMarks } from "./name-checks";
import { KnowledgeCell } from "./knowledge-cell";
import { useOpenSensor } from "./use-open-sensor";

const column = createColumnHelper<SensorRow>();

const columns = [
  column.accessor("alias", {
    header: "Alias",
    cell: ({ getValue }) => <AliasButton alias={getValue()} />,
    meta: { className: "font-mono" },
  }),
  column.accessor("sourceName", {
    header: () => <span title="Values in this column are never sent to any model.">Source column</span>,
    cell: ({ getValue }) => <span className="font-mono text-xs text-muted-foreground">{getValue()}</span>,
  }),
  column.accessor("signalType", { header: "Signal type" }),
  column.accessor("role", { header: "Role", filterFn: "equals" }),
  column.accessor((row) => row.hypothesisName ?? "", {
    id: "hypothesisName",
    header: "Hypothesis",
    cell: ({ row }) => {
      const name = row.original.hypothesisName;
      return (
        <span className="inline-flex min-w-0 flex-nowrap items-center gap-1.5">
          {name ? (
            <span className="min-w-0 max-w-48 truncate text-xs italic text-muted-foreground" title={name}>
              {name}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">no hypothesis (model off)</span>
          )}
          <NameCheckMarks checks={row.original.nameChecks} roleInferenceId={row.original.roleInferenceId} />
        </span>
      );
    },
  }),
  column.display({
    id: "knowledge",
    header: "Knowledge",
    cell: ({ row }) => <KnowledgeCell alias={row.original.alias} sourceName={row.original.sourceName} />,
  }),
  column.accessor("roleConfidence", {
    header: "Confidence",
    cell: ({ getValue }) => <ConfidenceBar value={getValue()} className="justify-end" />,
    meta: { numeric: true },
  }),
  column.accessor("health", {
    header: "Health",
    filterFn: "equals",
    cell: ({ getValue }) => <HealthBadge health={getValue()} />,
  }),
  column.accessor("status", {
    header: "Status",
    cell: ({ getValue }) => <StatusBadge kind={getValue()} />,
  }),
];

function AliasButton({ alias }: { alias: string }) {
  const open = useOpenSensor();
  return (
    <button
      type="button"
      className="rounded-sm underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      onClick={(event) => {
        event.stopPropagation();
        open(alias);
      }}
      aria-label={`Open ${alias}`}
    >
      {alias}
    </button>
  );
}

const all = "all";

export function SensorTable({ sensors, current, lens }: { sensors: SensorRow[]; current: string | null; lens: Lens }) {
  const open = useOpenSensor();
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const haystacks = useMemo(
    () => new Map(sensors.map((s) => [s.alias, [s.alias, s.sourceName, s.signalType, s.role, s.hypothesisName ?? "", s.health].join(" ").toLowerCase()])),
    [sensors],
  );

  const table = useReactTable({
    data: sensors,
    columns,
    state: { sorting, globalFilter, columnFilters },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onColumnFiltersChange: setColumnFilters,
    getColumnCanGlobalFilter: (col) => col.id === "alias",
    globalFilterFn: (row, _columnId, value: string) => (haystacks.get(row.original.alias) ?? "").includes(value.trim().toLowerCase()),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const filterValue = (id: string) => (table.getColumn(id)?.getFilterValue() as string | undefined) ?? all;
  const setFilter = (id: string, value: string) => table.getColumn(id)?.setFilterValue(value === all ? undefined : value);
  const shown = table.getRowModel().rows.length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-56 flex-1 flex-col gap-1.5">
          <Label htmlFor="sensor-search" className="text-xs text-muted-foreground">
            Search
          </Label>
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted-foreground" aria-hidden="true" />
            <Input
              id="sensor-search"
              type="search"
              value={globalFilter}
              onChange={(event) => setGlobalFilter(event.target.value)}
              placeholder="Alias, source column, role or hypothesis"
              className="pl-8"
            />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="role-filter" className="text-xs text-muted-foreground">
            Role
          </Label>
          <Select value={filterValue("role")} onValueChange={(value) => setFilter("role", value)}>
            <SelectTrigger id="role-filter" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={all}>All roles</SelectItem>
              {Role.options.map((role) => (
                <SelectItem key={role} value={role}>
                  {role}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="health-filter" className="text-xs text-muted-foreground">
            Health
          </Label>
          <Select value={filterValue("health")} onValueChange={(value) => setFilter("health", value)}>
            <SelectTrigger id="health-filter" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={all}>All health states</SelectItem>
              <SelectItem value="healthy">healthy</SelectItem>
              {HealthClass.options.map((health) => (
                <SelectItem key={health} value={health}>
                  {health}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="ml-auto text-xs text-muted-foreground" aria-live="polite">
          {shown} of {sensors.length} {lens.sensors}
        </p>
      </div>
      <DataTable
        table={table}
        label="Sensors"
        dense
        empty={`No ${lens.sensor} matches the filters.`}
        rowProps={(row) => ({
          id: row.original.alias,
          "data-state": row.original.alias === current ? "selected" : undefined,
          className: "cursor-pointer",
          onClick: () => open(row.original.alias),
        })}
      />
    </div>
  );
}
