import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { CheckIcon, MinusIcon } from "lucide-react";
import type { CalibrationInference, CalibrationValue } from "@tpm/schemas";
import { formatNumber } from "@/lib/format";
import { DataTable } from "@/components/data-table";
import { InferenceFooter } from "./inference-footer";
import type { DayLabel } from "./sample-range";
import { percent } from "./signal-lane";

type Threshold = { key: string; value: number };
type Detection = CalibrationValue["detection"][number];

const thresholdColumns: ColumnDef<Threshold>[] = [
  { accessorKey: "key", header: "Parameter", cell: ({ row }) => <span className="font-mono text-xs">{row.original.key}</span> },
  { accessorKey: "value", header: "Value", meta: { numeric: true }, cell: ({ row }) => formatNumber(row.original.value) },
];

export const calibrationSummary = (value: CalibrationValue) =>
  `False alarm rate ${percent(value.falseAlarmRate)} (target ${percent(value.targetFalseAlarmRate)}), ${value.detection.filter((d) => d.detected).length} of ${value.detection.length} injected faults detected`;

export function CalibrationDetail({ inference, title, day }: { inference: CalibrationInference; title: string; day: DayLabel }) {
  const { thresholds, detection } = inference.value;
  const rows = Object.entries(thresholds).map(([key, value]) => ({ key, value }));
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
    <div className="flex flex-col gap-3">
      <p>{inference.claim}</p>
      <p className="text-sm text-muted-foreground">{calibrationSummary(inference.value)}.</p>
      <DataTable label={`${title} thresholds`} columns={thresholdColumns} data={rows} getRowId={(t) => t.key} />
      <DataTable label={`${title} detection`} columns={detectionColumns} data={detection} empty="No injected faults." />
      <InferenceFooter inference={inference} />
    </div>
  );
}
