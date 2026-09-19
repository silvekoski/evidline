import type { ComponentProps } from "react";
import { flexRender, type Column, type Header, type Row, type Table as TableInstance } from "@tanstack/react-table";
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export type ColumnMeta = { align?: "right"; className?: string };

const metaOf = <T,>(column: Column<T, unknown>) => column.columnDef.meta as ColumnMeta | undefined;

const mono = "font-mono tabular-nums";

const sortIcon = { asc: ArrowUpIcon, desc: ArrowDownIcon, false: ArrowUpDownIcon } as const;
const ariaSort = { asc: "ascending", desc: "descending", false: "none" } as const;

function SortableHead<T>({ header }: { header: Header<T, unknown> }) {
  const { column } = header;
  const meta = metaOf(column);
  const right = meta?.align === "right";
  const content = header.isPlaceholder ? null : flexRender(column.columnDef.header, header.getContext());
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

export function DataTable<T>({
  table,
  empty,
  rowProps,
  className,
}: {
  table: TableInstance<T>;
  empty: string;
  rowProps?: (row: Row<T>) => ComponentProps<"tr">;
  className?: string;
}) {
  const rows = table.getRowModel().rows;
  return (
    <Table className={className}>
      <TableHeader>
        {table.getHeaderGroups().map((group) => (
          <TableRow key={group.id} className="hover:bg-transparent">
            {group.headers.map((header) => (
              <SortableHead key={header.id} header={header} />
            ))}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={table.getAllLeafColumns().length} className="py-6 text-center text-muted-foreground">
              {empty}
            </TableCell>
          </TableRow>
        ) : (
          rows.map((row) => (
            <TableRow key={row.id} {...rowProps?.(row)}>
              {row.getVisibleCells().map((cell) => {
                const meta = metaOf(cell.column);
                return (
                  <TableCell key={cell.id} className={cn("py-1", meta?.align === "right" && `text-right ${mono}`, meta?.className)}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                );
              })}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
