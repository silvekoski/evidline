import { Fragment, useState, type ComponentProps, type ReactNode } from "react";
import {
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type Column,
  type ColumnDef,
  type ExpandedState,
  type OnChangeFn,
  type Row,
  type SortingState,
  type Table as TableInstance,
  type TableOptions,
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

type RenderProps<T> = {
  label: string;
  renderExpanded?: (row: Row<T>) => ReactNode;
  rowProps?: (row: Row<T>) => ComponentProps<"tr"> & { "data-state"?: string };
  empty?: ReactNode;
  pagination?: boolean;
};

type ManagedProps<T> = RenderProps<T> & {
  columns: TableOptions<T>["columns"];
  data: T[];
  getRowId?: (row: T) => string;
  initialSorting?: SortingState;
  expanded?: ExpandedState;
  onExpandedChange?: OnChangeFn<ExpandedState>;
  pageSize?: number;
};

export function DataTable<T>(props: ManagedProps<T> | (RenderProps<T> & { table: TableInstance<T> })) {
  return "table" in props ? <TableView {...props} /> : <ManagedTable {...props} />;
}

function ManagedTable<T>({ columns, data, getRowId, initialSorting = [], expanded, onExpandedChange, pageSize = 50, ...props }: ManagedProps<T>) {
  const [sorting, setSorting] = useState<SortingState>(initialSorting);
  const [ownExpanded, setOwnExpanded] = useState<ExpandedState>({});
  const table = useReactTable({
    data,
    columns,
    state: { sorting, expanded: expanded ?? ownExpanded },
    initialState: { pagination: { pageSize } },
    onSortingChange: setSorting,
    onExpandedChange: onExpandedChange ?? setOwnExpanded,
    getRowId,
    getRowCanExpand: () => props.renderExpanded !== undefined,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getPaginationRowModel: props.pagination ? getPaginationRowModel() : undefined,
  });
  return <TableView {...props} table={table} />;
}

function TableView<T>({ table, label, renderExpanded, rowProps, empty = "No rows.", pagination }: RenderProps<T> & { table: TableInstance<T> }) {
  const rows = table.getRowModel().rows;
  const span = table.getVisibleLeafColumns().length;
  const { pageIndex, pageSize } = table.getState().pagination;
  const total = table.getPrePaginationRowModel().rows.length;
  const first = rows.length ? pageIndex * pageSize + 1 : 0;
  const last = Math.min(total, (pageIndex + 1) * pageSize);

  return (
    <>
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
                    aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : header.column.getCanSort() ? "none" : undefined}
                    className={cn("h-8", meta?.numeric && "text-right", meta?.className)}
                  >
                    {header.column.getCanSort() ? (
                      <Button variant="ghost" size="xs" className={cn("-mx-2 h-7 font-medium", meta?.numeric && "flex-row-reverse")} onClick={header.column.getToggleSortingHandler()}>
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
      {pagination && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-2 py-1.5 text-xs text-muted-foreground">
          <p aria-live="polite">Rows {first} to {last} of {total}</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
              Previous
            </Button>
            <Button variant="outline" size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
              Next
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
