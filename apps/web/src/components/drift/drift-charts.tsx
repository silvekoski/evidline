import { useId } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, XAxis, YAxis } from "recharts";
import type { ChartSpec, DriftValue, EvidenceSeries } from "@tpm/schemas";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { formatNumber } from "@/lib/format";
import { blockMedians, deviationKey, pickSeries } from "./drift-data";

type Props = { value: DriftValue; spec: ChartSpec; series: EvidenceSeries; limit: number | null };

const axisTick = { fontFamily: "var(--font-mono)", fontSize: 10 };
const dotted = { stroke: "var(--chart-2)", strokeDasharray: "1 3" } as const;
const markLabel = (text: string, position: "insideTopLeft" | "insideTopRight") =>
  ({ value: text, position, fill: "var(--muted-foreground)", fontSize: 10 }) as const;

const symmetricBound = (values: (number | null)[], limit: number | null) =>
  Math.max(limit ?? 0, ...values.map((v) => Math.abs(v ?? 0))) * 1.1 || 1;

export function DeviationSparkline({ value, spec, series, limit }: Props) {
  const rows = blockMedians(pickSeries(series, spec, deviationKey(value)) ?? [], series.t, 100);
  const bound = symmetricBound(rows.map((r) => r.v), limit);
  return (
    <ChartContainer config={{ v: { label: "deviation" } }} className="h-14 w-full aspect-auto" aria-hidden="true">
      <ComposedChart data={rows} margin={{ top: 2, right: 2, bottom: 2, left: 2 }} accessibilityLayer={false}>
        <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} hide />
        <YAxis domain={[-bound, bound]} hide />
        <ReferenceLine y={0} stroke="var(--chart-4)" />
        {limit !== null && <ReferenceLine y={limit} {...dotted} />}
        {limit !== null && <ReferenceLine y={-limit} {...dotted} />}
        {value.onset !== null && <ReferenceLine x={value.onset} stroke="var(--chart-2)" strokeDasharray="4 4" />}
        <Line dataKey="v" type="linear" dot={false} activeDot={false} isAnimationActive={false} stroke="var(--chart-1)" strokeWidth={1.5} connectNulls />
      </ComposedChart>
    </ChartContainer>
  );
}

export function DriftCharts({ value, spec, series, limit, label }: Props & { label: (sample: number) => string }) {
  const syncId = useId();
  const hatchId = useId();
  const key = deviationKey(value);
  const values = pickSeries(series, spec, value.sensor) ?? [];
  const expected = pickSeries(series, spec, "expected");
  const deviation = pickSeries(series, spec, key) ?? [];
  const band = spec.band ? ([spec.band.lo, spec.band.hi] as [number, number]) : undefined;
  const rows = series.t.map((t, i) => ({ t, value: values[i] ?? null, expected: expected?.[i] ?? null, deviation: deviation[i] ?? null, band }));
  const onset = spec.marks?.find((m) => m.kind === "onset")?.at ?? value.onset;
  const bound = symmetricBound(deviation, limit);
  const config: ChartConfig = { value: { label: value.sensor }, expected: { label: "expected from peers" }, deviation: { label: key } };
  const tooltip = (
    <ChartTooltip
      content={
        <ChartTooltipContent
          labelFormatter={(v) => label(Number(v))}
          formatter={(v, name) => [typeof v === "number" ? formatNumber(v) : String(v), config[String(name)]?.label ?? name]}
        />
      }
    />
  );
  const masks = (spec.masks ?? []).map((m) => (
    <ReferenceArea key={`${m.from}-${m.to}`} x1={m.from} x2={m.to} fill={`url(#${hatchId})`} fillOpacity={1} stroke="none" ifOverflow="visible" />
  ));
  const onsetLine = onset !== null && (
    <ReferenceLine x={onset} stroke="var(--chart-2)" strokeDasharray="4 4" label={markLabel("onset", "insideTopLeft")} ifOverflow="visible" />
  );
  const activeDot = { r: 3, fill: "var(--chart-1)", stroke: "none" };

  return (
    <div className="flex flex-col gap-1">
      <ChartContainer config={config} className="h-56 w-full aspect-auto">
        <ComposedChart data={rows} syncId={syncId} margin={{ top: 8, right: 24, bottom: 0, left: 0 }}>
          <defs>
            <pattern id={hatchId} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--chart-2)" strokeWidth="1" />
            </pattern>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} hide />
          <YAxis width={52} tick={axisTick} tickFormatter={formatNumber} tickLine={false} axisLine={false} domain={["auto", "auto"]} />
          {tooltip}
          {band && <Area dataKey="band" fill="var(--chart-1)" fillOpacity={0.06} stroke="none" isAnimationActive={false} activeDot={false} tooltipType="none" />}
          {masks}
          {expected && (
            <Line dataKey="expected" type="linear" dot={false} activeDot={activeDot} isAnimationActive={false} stroke="var(--chart-2)" strokeWidth={1.5} strokeDasharray="6 4" />
          )}
          <Line dataKey="value" type="linear" dot={false} activeDot={activeDot} isAnimationActive={false} stroke="var(--chart-1)" strokeWidth={2} />
          {onsetLine}
        </ComposedChart>
      </ChartContainer>
      <ChartContainer config={config} className="h-36 w-full aspect-auto">
        <ComposedChart data={rows} syncId={syncId} margin={{ top: 8, right: 24, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={label} tick={axisTick} tickLine={false} axisLine={false} minTickGap={48} />
          <YAxis width={52} domain={[-bound, bound]} tick={axisTick} tickFormatter={formatNumber} tickLine={false} axisLine={false} />
          {tooltip}
          {masks}
          <ReferenceLine y={0} stroke="var(--chart-4)" />
          {limit !== null && <ReferenceLine y={limit} {...dotted} label={markLabel("limit", "insideTopRight")} />}
          {limit !== null && <ReferenceLine y={-limit} {...dotted} />}
          <Line
            dataKey="deviation"
            type="linear"
            dot={false}
            activeDot={activeDot}
            isAnimationActive={false}
            stroke="var(--chart-1)"
            strokeWidth={1.5}
            connectNulls={value.method === "distribution"}
          />
          {onsetLine}
        </ComposedChart>
      </ChartContainer>
    </div>
  );
}
