import { Fragment, useState, type ComponentProps, type ReactNode } from "react";
import {
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getSortedRowModel,
  useReactTable,
  type Column,
  type ColumnDef,
  type ExpandedState,
  type OnChangeFn,
  type Row,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowDownIcon, ArrowUpIcon, ChevronDownIcon, ChevronRightIcon, ChevronsUpDownIcon } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export type ColumnMeta = { numeric?: boolean; className?: string };

const metaOf = <T,>(column: Column<T>) => column.columnDef.meta as ColumnMeta | undefined;

export function expandColumn<T>(label: (row: T) => string): ColumnDef<T> {
  return {
    id: "expand",
    header: () => <span className="sr-only">Details</span>,
    enableSorting: false,
    meta: { className: "w-8 pr-0" },
    cell: ({ row }) => {
      const open = row.getIsExpanded();
      return (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-expanded={open}
          aria-controls={open ? `${row.id}-detail` : undefined}
          aria-label={label(row.original)}
          onClick={row.getToggleExpandedHandler()}
        >
          {open ? <ChevronDownIcon aria-hidden="true" /> : <ChevronRightIcon aria-hidden="true" />}
        </Button>
      );
    },
  };
}

export function DataTable<T>({
  columns,
  data,
  label,
  getRowId,
  initialSorting = [],
  expanded,
  onExpandedChange,
  renderExpanded,
  rowProps,
  empty = "No rows.",
}: {
  columns: ColumnDef<T>[];
  data: T[];
  label: string;
  getRowId?: (row: T) => string;
  initialSorting?: SortingState;
  expanded?: ExpandedState;
  onExpandedChange?: OnChangeFn<ExpandedState>;
  renderExpanded?: (row: Row<T>) => ReactNode;
  rowProps?: (row: Row<T>) => ComponentProps<"tr"> & { "data-state"?: string };
  empty?: ReactNode;
}) {
  const [sorting, setSorting] = useState<SortingState>(initialSorting);
  const [ownExpanded, setOwnExpanded] = useState<ExpandedState>({});
  const table = useReactTable({
    data,
    columns,
    state: { sorting, expanded: expanded ?? ownExpanded },
    onSortingChange: setSorting,
    onExpandedChange: onExpandedChange ?? setOwnExpanded,
    getRowId,
    getRowCanExpand: () => renderExpanded !== undefined,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
  });
  const rows = table.getRowModel().rows;
  const span = table.getVisibleLeafColumns().length;

  return (
    <Table aria-label={label}>
      <TableHeader>
        {table.getHeaderGroups().map((group) => (
          <TableRow key={group.id}>
            {group.headers.map((header) => {
              const meta = metaOf(header.column);
              const sorted = header.column.getIsSorted();
              const content = header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext());
              return (
                <TableHead
                  key={header.id}
                  scope="col"
                  aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined}
                  className={cn("h-8", meta?.numeric && "text-right", meta?.className)}
                >
                  {header.column.getCanSort() ? (
                    <Button variant="ghost" size="sm" className="-mx-2 text-sm" onClick={header.column.getToggleSortingHandler()}>
                      {content}
                      {sorted === "asc" ? (
                        <ArrowUpIcon aria-hidden="true" />
                      ) : sorted === "desc" ? (
                        <ArrowDownIcon aria-hidden="true" />
                      ) : (
                        <ChevronsUpDownIcon aria-hidden="true" className="text-muted-foreground" />
                      )}
                    </Button>
                  ) : (
                    content
                  )}
                </TableHead>
              );
            })}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={span} className="py-4 text-center text-muted-foreground">
              {empty}
            </TableCell>
          </TableRow>
        ) : (
          rows.map((row) => (
            <Fragment key={row.id}>
              <TableRow {...rowProps?.(row)}>
                {row.getVisibleCells().map((cell) => {
                  const meta = metaOf(cell.column);
                  return (
                    <TableCell key={cell.id} className={cn("py-1", meta?.numeric && "text-right font-mono tabular-nums", meta?.className)}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  );
                })}
              </TableRow>
              {row.getIsExpanded() && renderExpanded && (
                <TableRow id={`${row.id}-detail`} className="hover:bg-transparent">
                  <TableCell colSpan={span} className="whitespace-normal p-3">
                    {renderExpanded(row)}
                  </TableCell>
                </TableRow>
              )}
            </Fragment>
          ))
        )}
      </TableBody>
    </Table>
  );
}
