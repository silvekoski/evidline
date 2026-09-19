import { useMemo, useState } from "react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type Header,
  type SortingState,
} from "@tanstack/react-table";
import { Link } from "react-router";
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon } from "lucide-react";
import { cn } from "cn";
import type { RankedSensor } from "@tpm/schemas";
import { useLens } from "@/hooks/use-lens";
import { screenPath } from "@/layout/screens";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatNumber } from "@/lib/format";

type Row = RankedSensor & { rank: number };
type Meta = { right?: boolean };

const column = createColumnHelper<Row>();
const right = { right: true } satisfies Meta;
const isRight = (meta: unknown) => (meta as Meta | undefined)?.right === true;

const sortIcon = { asc: ArrowUpIcon, desc: ArrowDownIcon, false: ArrowUpDownIcon } as const;
const ariaSort = { asc: "ascending", desc: "descending", false: "none" } as const;

function SortableHead({ header }: { header: Header<Row, unknown> }) {
  const { column: col } = header;
  const sorted = col.getIsSorted() || "false";
  const Icon = sortIcon[sorted];
  return (
    <TableHead scope="col" aria-sort={ariaSort[sorted]} className={cn("h-8", isRight(col.columnDef.meta) && "text-right")}>
      <Button variant="ghost" size="xs" className={cn("-mx-2 h-7 font-medium", isRight(col.columnDef.meta) && "flex-row-reverse")} onClick={col.getToggleSortingHandler()}>
        {flexRender(col.columnDef.header, header.getContext())}
        <Icon className={cn(sorted === "false" && "text-muted-foreground")} aria-hidden="true" />
      </Button>
    </TableHead>
  );
}

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
  const [sorting, setSorting] = useState<SortingState>([{ id: "contribution", desc: true }]);
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
  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });
  const rows = table.getRowModel().rows;

  return (
    <Table>
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
            <TableCell colSpan={columns.length} className="py-3 text-center text-muted-foreground">
              No ranked {lens.sensor}. The health gate masked every candidate.
            </TableCell>
          </TableRow>
        ) : (
          rows.map((row) => (
            <TableRow key={row.id} data-state={row.original.sensor === current ? "selected" : undefined}>
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id} className={cn("py-1", isRight(cell.column.columnDef.meta) && "text-right font-mono tabular-nums")}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
