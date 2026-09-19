import { useEffect, useMemo, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type Column,
  type ColumnFiltersState,
  type ExpandedState,
  type Header,
  type PaginationState,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon, ListFilterIcon, SearchIcon } from "lucide-react";
import { cn } from "cn";
import { LogType, type Lens, type LogEntry } from "@tpm/schemas";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
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
import { Table, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ScreenSlug } from "@/layout/screens";
import { actorWord, logColumns, type ColumnMeta } from "./log-columns";
import { LogEntryDetail } from "./log-entry-detail";

const pageSize = 50;
const all = "all";

const metaOf = <T,>(column: Column<LogEntry, T>) => column.columnDef.meta as ColumnMeta | undefined;

const sortIcon = { asc: ArrowUpIcon, desc: ArrowDownIcon, false: ArrowUpDownIcon } as const;
const ariaSort = { asc: "ascending", desc: "descending", false: "none" } as const;

function SortHead({ header }: { header: Header<LogEntry, unknown> }) {
  const { column } = header;
  const meta = metaOf(column);
  const right = meta?.align === "right";
  const content = flexRender(column.columnDef.header, header.getContext());
  if (!column.getCanSort()) {
    return (
      <TableHead scope="col" className={cn("h-8", right && "text-right", meta?.className)}>
        {content}
      </TableHead>
    );
  }
  const sorted = column.getIsSorted() || "false";
  const Icon = sortIcon[sorted];
  return (
    <TableHead scope="col" aria-sort={ariaSort[sorted]} className={cn("h-8", right && "text-right", meta?.className)}>
      <Button variant="ghost" size="xs" className={cn("-mx-2 h-7 font-medium", right && "flex-row-reverse")} onClick={column.getToggleSortingHandler()}>
        {content}
        <Icon className={cn(sorted === "false" && "text-muted-foreground")} aria-hidden="true" />
      </Button>
    </TableHead>
  );
}

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
  const rows = table.getRowModel().rows;
  const span = table.getVisibleLeafColumns().length;
  const shown = orderedRows.length;
  const first = shown === 0 ? 0 : pagination.pageIndex * pageSize + 1;
  const last = Math.min(shown, (pagination.pageIndex + 1) * pageSize);

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
      <Table aria-label="Decision log">
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id} className="hover:bg-transparent">
              {group.headers.map((header) => (
                <SortHead key={header.id} header={header} />
              ))}
            </TableRow>
          ))}
        </TableHeader>
        {rows.length === 0 ? (
          <tbody>
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={span} className="py-6 text-center text-muted-foreground">
                No entry matches the filters.
              </TableCell>
            </TableRow>
          </tbody>
        ) : (
          rows.map((row) => (
            <Collapsible key={row.id} asChild open={row.getIsExpanded()} onOpenChange={(open) => row.toggleExpanded(open)}>
              <tbody className="border-b last:border-0">
                <TableRow id={`log-${row.id}`} className="border-0" data-state={target !== "" && row.original.inferenceId === target ? "selected" : undefined}>
                  {row.getVisibleCells().map((cell) => {
                    const meta = metaOf(cell.column);
                    return (
                      <TableCell key={cell.id} className={cn("py-1", meta?.align === "right" && "text-right font-mono tabular-nums", meta?.className)}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    );
                  })}
                </TableRow>
                <CollapsibleContent asChild>
                  <TableRow className="border-0 hover:bg-transparent">
                    <TableCell colSpan={span} className="p-3 whitespace-normal">
                      <LogEntryDetail entry={row.original} />
                    </TableCell>
                  </TableRow>
                </CollapsibleContent>
              </tbody>
            </Collapsible>
          ))
        )}
      </Table>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <p aria-live="polite">
          Rows {first} to {last} of {shown}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
            Previous
          </Button>
          <Button variant="outline" size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
