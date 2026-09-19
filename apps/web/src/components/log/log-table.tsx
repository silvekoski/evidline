import { useEffect, useMemo, useState } from "react";
import {
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnFiltersState,
  type ExpandedState,
  type PaginationState,
  type SortingState,
} from "@tanstack/react-table";
import { ListFilterIcon, SearchIcon } from "lucide-react";
import { LogType, type Lens, type LogEntry } from "@tpm/schemas";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ScreenSlug } from "@/layout/screens";
import { actorWord, logColumns } from "./log-columns";
import { DataTable } from "@/components/data-table";
import { LogEntryDetail } from "./log-entry-detail";

const pageSize = 50;
const all = "all";

export function LogTable({
  entries,
  runId,
  target,
  screens,
  lens,
}: {
  entries: LogEntry[];
  runId: string;
  target: string;
  screens: Map<string, ScreenSlug>;
  lens: Lens;
}) {
  const [sorting, setSorting] = useState<SortingState>([{ id: "seq", desc: true }]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [expanded, setExpanded] = useState<ExpandedState>({});
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize });
  const columns = useMemo(() => logColumns(runId, lens, screens), [runId, lens, screens]);
  const haystacks = useMemo(
    () =>
      new Map(
        entries.map((e) => [
          e.seq,
          [e.seq, e.time, e.type, e.actor, e.inferenceId ?? "", e.evidenceIds.join(" "), e.egressId ?? "", e.reason ?? "", e.hash, JSON.stringify(e.before), JSON.stringify(e.after)]
            .join(" ")
            .toLowerCase(),
        ]),
      ),
    [entries],
  );

  const table = useReactTable({
    data: entries,
    columns,
    state: { sorting, columnFilters, globalFilter, expanded, pagination },
    onSortingChange: setSorting,
    onColumnFiltersChange: (update) => {
      setColumnFilters(update);
      setPagination((p) => ({ ...p, pageIndex: 0 }));
    },
    onGlobalFilterChange: (update) => {
      setGlobalFilter(update);
      setPagination((p) => ({ ...p, pageIndex: 0 }));
    },
    onExpandedChange: setExpanded,
    onPaginationChange: setPagination,
    autoResetPageIndex: false,
    getRowId: (entry) => String(entry.seq),
    getRowCanExpand: () => true,
    getColumnCanGlobalFilter: (col) => col.id === "seq",
    globalFilterFn: (row, _columnId, value: string) => (haystacks.get(row.original.seq) ?? "").includes(value.trim().toLowerCase()),
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  const orderedRows = table.getPrePaginationRowModel().rows;
  const targetIndex = target === "" ? -1 : orderedRows.findIndex((row) => row.original.inferenceId === target);
  const targetRowId = targetIndex < 0 ? null : orderedRows[targetIndex]!.id;

  useEffect(() => {
    if (targetRowId === null) return;
    setPagination((p) => ({ ...p, pageIndex: Math.floor(targetIndex / p.pageSize) }));
    setExpanded({ [targetRowId]: true });
  }, [targetRowId]);

  useEffect(() => {
    if (targetRowId !== null) document.getElementById(`log-${targetRowId}`)?.scrollIntoView({ block: "nearest" });
  }, [targetRowId, pagination.pageIndex]);

  const types = (table.getColumn("type")?.getFilterValue() as string[] | undefined) ?? [];
  const setTypes = (next: string[]) => table.getColumn("type")?.setFilterValue(next.length === 0 ? undefined : next);
  const actor = (table.getColumn("actor")?.getFilterValue() as LogEntry["actor"] | undefined) ?? all;
  const shown = orderedRows.length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-56 flex-1 flex-col gap-1.5">
          <Label htmlFor="log-search" className="text-xs text-muted-foreground">
            Search
          </Label>
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted-foreground" aria-hidden="true" />
            <Input
              id="log-search"
              type="search"
              value={globalFilter}
              onChange={(event) => table.setGlobalFilter(event.target.value)}
              placeholder="Reason, inference, evidence, egress, hash or value"
              className="pl-8"
            />
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">
              <ListFilterIcon aria-hidden="true" />
              Type
              {types.length > 0 && <span className="font-mono text-xs text-muted-foreground">{types.length}</span>}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-48">
            <DropdownMenuLabel>Entry type</DropdownMenuLabel>
            {LogType.options.map((type) => (
              <DropdownMenuCheckboxItem
                key={type}
                checked={types.includes(type)}
                onCheckedChange={(checked) => setTypes(checked ? [...types, type] : types.filter((t) => t !== type))}
                onSelect={(event) => event.preventDefault()}
              >
                {type}
              </DropdownMenuCheckboxItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={types.length === 0} onSelect={() => setTypes([])}>
              Clear
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">
              <ListFilterIcon aria-hidden="true" />
              Actor: {actor === all ? all : actorWord(actor, lens)}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-40">
            <DropdownMenuRadioGroup value={actor} onValueChange={(value) => table.getColumn("actor")?.setFilterValue(value === all ? undefined : value)}>
              <DropdownMenuRadioItem value={all}>All actors</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="agent">agent</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="operator">{lens.operator}</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <p className="ml-auto text-xs text-muted-foreground" aria-live="polite">
          {shown} of {entries.length} entries
        </p>
      </div>
      <DataTable
        table={table}
        label="Decision log"
        empty="No entry matches the filters."
        pagination
        renderExpanded={(row) => <LogEntryDetail entry={row.original} />}
        rowProps={(row) => ({
          id: `log-${row.id}`,
          "data-state": target !== "" && row.original.inferenceId === target ? "selected" : undefined,
        })}
      />
    </div>
  );
}
