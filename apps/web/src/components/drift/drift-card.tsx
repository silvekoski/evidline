import { useEffect, useRef } from "react";
import { Link, useLocation } from "react-router";
import { cn } from "cn";
import type { DriftInference } from "@tpm/schemas";
import { ConfidenceBar } from "@/components/confidence-bar";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber } from "@/lib/format";
import { DeviationSparkline } from "./drift-charts";
import { deviationLimit, inRangeLine, isDrifting, useResidual } from "./drift-data";

export function DriftCard({ inference, selected, label }: { inference: DriftInference; selected: boolean; label: (sample: number) => string }) {
  const { value } = inference;
  const residual = useResidual(inference);
  const limit = deviationLimit(value, residual.evidence?.chart);
  const { hash } = useLocation();
  const targeted = hash === `#${value.sensor}` || hash === `#${inference.id}`;
  const ref = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (targeted) ref.current?.scrollIntoView({ block: "nearest" });
  }, [targeted]);

  const summary = [
    `max deviation ${formatNumber(value.maxDeviation)}`,
    limit !== null ? `limit ${formatNumber(limit)}` : null,
    value.onset !== null ? `onset ${label(value.onset)}` : "no onset",
  ]
    .filter((part) => part !== null)
    .join(", ");

  return (
    <Link
      ref={ref}
      to={{ hash: `#${value.sensor}` }}
      replace
      aria-current={selected ? "true" : undefined}
      className="block rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <Card size="sm" className={cn("h-full gap-2", selected && "ring-foreground")}>
        <CardHeader>
          <CardTitle className="font-mono">{value.sensor}</CardTitle>
          <CardAction>{isDrifting(value) ? <StatusBadge kind="drift" /> : <StatusBadge kind="healthy" label="No drift" />}</CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-1.5">
          <div className="flex justify-between gap-2 font-mono text-xs text-muted-foreground tabular-nums">
            <span>
              severity <span className="text-foreground">{formatNumber(value.severity)}</span>
            </span>
            <span>
              rate <span className="text-foreground">{formatNumber(value.ratePer1000)}</span> / 1000
            </span>
          </div>
          <p className="text-xs">{inRangeLine(value)}</p>
          <figure className="flex flex-col gap-1">
            {residual.series && residual.evidence ? (
              <DeviationSparkline value={value} spec={residual.evidence.chart} series={residual.series} limit={limit} />
            ) : residual.error ? (
              <p className="flex h-14 items-center text-xs text-muted-foreground">{residual.error.message}</p>
            ) : (
              <Skeleton className="h-14 w-full" />
            )}
            <figcaption className="font-mono text-xs text-muted-foreground tabular-nums">{summary}</figcaption>
          </figure>
          <div className="flex items-center justify-between gap-2">
            <StatusBadge kind={inference.status} />
            <ConfidenceBar value={inference.confidence} />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
