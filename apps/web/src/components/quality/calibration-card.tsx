import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { CheckIcon, MinusIcon } from "lucide-react";
import { cn } from "cn";
import type { CalibrationInference, CalibrationValue } from "@tpm/schemas";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatNumber } from "@/lib/format";
import { DataTable } from "./data-table";
import { InferenceFooter } from "./inference-footer";
import type { DayLabel } from "./sample-range";

type Threshold = { key: string; value: number };
type Detection = CalibrationValue["detection"][number];

const thresholdColumns: ColumnDef<Threshold>[] = [
  { accessorKey: "key", header: "Parameter", cell: ({ row }) => <span className="font-mono text-xs">{row.original.key}</span> },
  { accessorKey: "value", header: "Value", meta: { numeric: true }, cell: ({ row }) => formatNumber(row.original.value) },
];

const percent = (x: number) => `${(x * 100).toFixed(1)} %`;

export function CalibrationCard({ inference, title, day, targeted }: { inference: CalibrationInference; title: string; day: DayLabel; targeted: boolean }) {
  const { thresholds, falseAlarmRate, targetFalseAlarmRate, detection } = inference.value;
  const rows = Object.entries(thresholds).map(([key, value]) => ({ key, value }));
  const detected = detection.filter((d) => d.detected).length;
  const detectionColumns = useMemo<ColumnDef<Detection>[]>(
    () => [
      { accessorKey: "fault", header: "Fault" },
      { accessorKey: "magnitude", header: "Magnitude", meta: { numeric: true }, cell: ({ row }) => formatNumber(row.original.magnitude) },
      {
        id: "detected",
        accessorFn: (d) => (d.detected ? 1 : 0),
        header: "Detected",
        cell: ({ row }) =>
          row.original.detected ? (
            <span className="inline-flex items-center gap-1">
              <CheckIcon className="size-3.5" aria-hidden="true" />
              detected
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <MinusIcon className="size-3.5" aria-hidden="true" />
              missed
            </span>
          ),
      },
      {
        accessorKey: "delay",
        header: "Delay (samples)",
        meta: { numeric: true },
        sortUndefined: "last",
        cell: ({ row }) => {
          const delay = row.original.delay;
          if (delay === null) return null;
          return (
            <>
              {delay}
              {day && <span className="ml-1 text-xs text-muted-foreground">{day(delay)}</span>}
            </>
          );
        },
      },
    ],
    [day],
  );

  return (
    <Card id={inference.id} tabIndex={-1} className={cn(targeted && "ring-foreground/40")}>
      <CardHeader>
        <CardTitle>
          {title} <span className="ml-1 font-mono text-xs font-normal text-muted-foreground">{inference.id}</span>
        </CardTitle>
        <CardDescription>{inference.claim}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p>
          False alarm rate <span className="font-mono tabular-nums">{percent(falseAlarmRate)}</span> against a target of{" "}
          <span className="font-mono tabular-nums">{percent(targetFalseAlarmRate)}</span>. The agent detected{" "}
          <span className="font-mono tabular-nums">{detected}</span> of <span className="font-mono tabular-nums">{detection.length}</span> injected faults.
        </p>
        <DataTable label={`${title} thresholds`} columns={thresholdColumns} data={rows} getRowId={(t) => t.key} />
        <DataTable label={`${title} detection`} columns={detectionColumns} data={detection} empty="No injected faults." />
        <InferenceFooter inference={inference} />
      </CardContent>
    </Card>
  );
}
