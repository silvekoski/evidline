import { useId } from "react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  ReferenceArea,
  ReferenceLine,
  Line,
  Scatter,
  ScatterChart,
  XAxis,
  YAxis,
} from "recharts";
import type { ChartMark, ChartSeries, ChartSpec, EvidenceSeries } from "@tpm/schemas";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { formatNumber } from "@/lib/format";

type Props = { spec: ChartSpec; series: EvidenceSeries | undefined; label: (sample: number) => string };

const strokes = {
  solid: { stroke: "var(--chart-1)", strokeWidth: 2 },
  dashed: { stroke: "var(--chart-2)", strokeWidth: 1.5, strokeDasharray: "6 4" },
  thin: { stroke: "var(--chart-3)", strokeWidth: 1 },
  dotted: { stroke: "var(--chart-2)", strokeWidth: 1, strokeDasharray: "2 3" },
} as const;

const chartColor = (i: number) => `var(--chart-${Math.min(i + 1, 5)})`;
const axisTick = { fontFamily: "var(--font-mono)", fontSize: 10 };
const markLabel = (text: string, position: "insideTopLeft" | "insideBottomLeft" | "insideTopRight" = "insideTopLeft") =>
  ({ value: text, position, fill: "var(--muted-foreground)", fontSize: 10 }) as const;

function seriesValues(data: EvidenceSeries | undefined, s: ChartSeries): (number | null)[] {
  const name = "sensor" in s.source ? s.source.sensor : s.source.derived;
  return data?.series[s.key] ?? data?.series[name] ?? [];
}

export function chartSummary(spec: ChartSpec, label: (sample: number) => string): string {
  const parts: string[] = [];
  if (spec.type === "line" || spec.type === "scatter") {
    const names = [...spec.series, ...(spec.secondary ?? [])].map((s) => `${s.label} (${s.style})`);
    parts.push(`${spec.type} chart of ${names.join(", ")} from ${label(spec.window.from)} to ${label(spec.window.to)}`);
    if (spec.band) parts.push(`${spec.band.label} from ${formatNumber(spec.band.lo)} to ${formatNumber(spec.band.hi)}`);
    if (spec.threshold !== undefined) parts.push(`threshold ${formatNumber(spec.threshold)}`);
    if (spec.masks?.length) parts.push(`${spec.masks.length} masked window${spec.masks.length === 1 ? "" : "s"}`);
  }
  if (spec.type === "histogram") parts.push(`histogram of ${(spec.histograms ?? []).map((h) => h.label).join(", ")}`);
  if (spec.type === "lag") parts.push(`correlation over ${spec.lags?.length ?? 0} lags`);
  if (spec.type === "bar") parts.push(`bars: ${(spec.bars ?? []).map((b) => `${b.label} ${formatNumber(b.value)}`).join(", ")}`);
  for (const m of spec.marks ?? []) {
    parts.push(m.kind === "best-lag" ? `best lag ${m.at}` : `${m.label} at ${m.kind === "threshold" ? formatNumber(m.at) : label(m.at)}`);
  }
  return `${parts.join(". ")}.`;
}

export function EvidenceChart({ spec, series, label }: Props) {
  switch (spec.type) {
    case "line":
      return <LineCharts spec={spec} series={series} label={label} />;
    case "histogram":
      return <HistogramChart spec={spec} />;
    case "lag":
      return <LagChart spec={spec} />;
    case "bar":
      return <BarsChart spec={spec} />;
    case "scatter":
      return <ScatterPlot spec={spec} series={series} />;
  }
}

function LineCharts({ spec, series, label }: Props) {
  const syncId = useId();
  const t = series?.t ?? [];
  const rows = t.map((time, i) => {
    const row: Record<string, number | null | [number, number]> = { t: time };
    for (const s of [...spec.series, ...(spec.secondary ?? [])]) row[s.key] = seriesValues(series, s)[i] ?? null;
    if (spec.band) row.band = [spec.band.lo, spec.band.hi];
    return row;
  });
  const marks = spec.marks ?? [];
  const timeMarks = marks.filter((m) => m.kind !== "threshold" && m.kind !== "best-lag");
  const config: ChartConfig = Object.fromEntries([...spec.series, ...(spec.secondary ?? [])].map((s) => [s.key, { label: s.label }]));
  const shared = { rows, label, syncId, marks: timeMarks, masks: spec.masks ?? [], config };
  return (
    <div className="flex flex-col gap-1">
      <TimeChart {...shared} series={spec.series} band={spec.band} hideAxis={!!spec.secondary?.length} height="h-56" threshold={spec.secondary?.length ? undefined : spec.threshold} />
      {spec.secondary?.length ? <TimeChart {...shared} series={spec.secondary} height="h-36" threshold={spec.threshold} /> : null}
    </div>
  );
}

function TimeChart({
  rows,
  series,
  band,
  marks,
  masks,
  threshold,
  label,
  syncId,
  config,
  hideAxis = false,
  height,
}: {
  rows: Record<string, number | null | [number, number]>[];
  series: ChartSeries[];
  band?: ChartSpec["band"];
  marks: ChartMark[];
  masks: { from: number; to: number }[];
  threshold?: number;
  label: (sample: number) => string;
  syncId: string;
  config: ChartConfig;
  hideAxis?: boolean;
  height: string;
}) {
  const hatchId = useId();
  return (
    <ChartContainer config={config} className={`${height} w-full aspect-auto`}>
      <ComposedChart data={rows} syncId={syncId} margin={{ top: 8, right: 24, bottom: 0, left: 0 }}>
        <defs>
          <pattern id={hatchId} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--chart-2)" strokeWidth="1" />
          </pattern>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={label} tick={axisTick} tickLine={false} axisLine={false} minTickGap={48} hide={hideAxis} />
        <YAxis width={52} tick={axisTick} tickFormatter={formatNumber} tickLine={false} axisLine={false} domain={["auto", "auto"]} />
        <ChartTooltip content={<ChartTooltipContent labelFormatter={(value) => label(Number(value))} formatter={(value, name) => [typeof value === "number" ? formatNumber(value) : String(value), config[String(name)]?.label ?? name]} />} />
        {band && <Area dataKey="band" fill="var(--chart-1)" fillOpacity={0.06} stroke="none" isAnimationActive={false} activeDot={false} tooltipType="none" />}
        {masks.map((m) => (
          <ReferenceArea key={`${m.from}-${m.to}`} x1={m.from} x2={m.to} fill={`url(#${hatchId})`} fillOpacity={1} stroke="none" ifOverflow="visible" />
        ))}
        {series.map((s) => (
          <Line key={s.key} dataKey={s.key} type="linear" dot={false} activeDot={{ r: 3, fill: "var(--chart-1)", stroke: "none" }} isAnimationActive={false} {...strokes[s.style]} />
        ))}
        {marks.map((m) => (
          <ReferenceLine key={`${m.kind}-${m.at}`} x={m.at} stroke={m.kind === "boundary" ? "var(--chart-4)" : "var(--chart-2)"} strokeDasharray={m.kind === "boundary" ? undefined : "4 4"} label={markLabel(m.label, m.kind === "boundary" ? "insideBottomLeft" : "insideTopLeft")} ifOverflow="visible" />
        ))}
        {threshold !== undefined && <ReferenceLine y={threshold} stroke="var(--chart-2)" strokeDasharray="1 3" label={markLabel("threshold", "insideTopRight")} ifOverflow="extendDomain" />}
      </ComposedChart>
    </ChartContainer>
  );
}

function HistogramChart({ spec }: { spec: ChartSpec }) {
  const histograms = spec.histograms ?? [];
  const edges = histograms[0]?.edges ?? [];
  const bins = histograms[0]?.shares.length ?? 0;
  const rows = Array.from({ length: bins }, (_, i) => {
    const row: Record<string, number> = { bin: i };
    histograms.forEach((h, j) => (row[`h${j}`] = h.shares[i] ?? 0));
    return row;
  });
  const config: ChartConfig = Object.fromEntries(histograms.map((h, j) => [`h${j}`, { label: h.label, color: chartColor(j) }]));
  return (
    <ChartContainer config={config} className="h-48 w-full aspect-auto">
      <BarChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }} barCategoryGap={1}>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis dataKey="bin" tick={axisTick} tickLine={false} axisLine={false} tickFormatter={(i: number) => formatNumber(edges[i] ?? i)} minTickGap={24} />
        <YAxis width={44} tick={axisTick} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} />
        <ChartTooltip content={<ChartTooltipContent labelFormatter={(_, payload) => { const i = Number(payload[0]?.payload?.bin ?? 0); return `${formatNumber(edges[i] ?? i)} to ${formatNumber(edges[i + 1] ?? i + 1)}`; }} formatter={(value, name) => [`${(Number(value) * 100).toFixed(1)}%`, config[String(name)]?.label ?? name]} />} />
        {histograms.length > 1 && <ChartLegend content={<ChartLegendContent />} />}
        {histograms.map((_, j) => (
          <Bar key={j} dataKey={`h${j}`} fill={chartColor(j)} isAnimationActive={false} />
        ))}
      </BarChart>
    </ChartContainer>
  );
}

function LagChart({ spec }: { spec: ChartSpec }) {
  const best = spec.marks?.find((m) => m.kind === "best-lag");
  return (
    <ChartContainer config={{ rho: { label: "rho" } }} className="h-48 w-full aspect-auto">
      <BarChart data={spec.lags ?? []} margin={{ top: 8, right: 12, bottom: 0, left: 0 }} barCategoryGap={1}>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis dataKey="lag" tick={axisTick} tickLine={false} axisLine={false} minTickGap={24} />
        <YAxis width={44} domain={[-1, 1]} tick={axisTick} tickLine={false} axisLine={false} tickFormatter={formatNumber} />
        <ChartTooltip content={<ChartTooltipContent labelFormatter={(value) => `lag ${value}`} formatter={(value) => [formatNumber(Number(value)), "rho"]} />} />
        <ReferenceLine y={0} stroke="var(--chart-4)" />
        <Bar dataKey="rho" fill="var(--chart-2)" isAnimationActive={false} />
        {best && <ReferenceLine x={best.at} stroke="var(--chart-1)" strokeDasharray="4 4" label={markLabel(best.label)} />}
      </BarChart>
    </ChartContainer>
  );
}

function BarsChart({ spec }: { spec: ChartSpec }) {
  const bars = spec.bars ?? [];
  return (
    <ChartContainer config={{ value: { label: "value" } }} className="w-full aspect-auto" style={{ height: Math.max(120, bars.length * 26 + 24) }}>
      <BarChart data={bars} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 0 }} barCategoryGap={4}>
        <CartesianGrid horizontal={false} stroke="var(--border)" />
        <XAxis type="number" tick={axisTick} tickLine={false} axisLine={false} tickFormatter={formatNumber} />
        <YAxis type="category" dataKey="label" width={140} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
        <ChartTooltip content={<ChartTooltipContent hideIndicator formatter={(value) => [formatNumber(Number(value)), "value"]} />} />
        <Bar dataKey="value" fill="var(--chart-2)" isAnimationActive={false} />
      </BarChart>
    </ChartContainer>
  );
}

function ScatterPlot({ spec, series }: { spec: ChartSpec; series: EvidenceSeries | undefined }) {
  const [sx, sy] = spec.series;
  if (!sx || !sy) return null;
  const xs = seriesValues(series, sx);
  const ys = seriesValues(series, sy);
  const rows = xs.flatMap((x, i) => (x === null || ys[i] == null ? [] : [{ x, y: ys[i] as number }]));
  return (
    <ChartContainer config={{ x: { label: sx.label }, y: { label: sy.label } }} className="h-56 w-full aspect-auto">
      <ScatterChart margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--border)" />
        <XAxis dataKey="x" type="number" name={sx.label} tick={axisTick} tickLine={false} axisLine={false} tickFormatter={formatNumber} />
        <YAxis dataKey="y" type="number" name={sy.label} width={52} tick={axisTick} tickLine={false} axisLine={false} tickFormatter={formatNumber} />
        <ChartTooltip content={<ChartTooltipContent hideLabel formatter={(value, name) => [formatNumber(Number(value)), name]} />} />
        <Scatter data={rows} fill="var(--chart-2)" isAnimationActive={false} />
      </ScatterChart>
    </ChartContainer>
  );
}
