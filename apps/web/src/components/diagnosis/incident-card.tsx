import { useEffect, useRef } from "react";
import { Link, useLocation } from "react-router";
import { cn } from "cn";
import type { DiagnosisInference, DiagnosisValue } from "@tpm/schemas";
import { ConfidenceBar } from "@/components/confidence-bar";
import { FaultBadge } from "@/components/fault-badge";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatNumber } from "@/lib/format";
import { WindowTrack } from "./window-track";

const hatch = { backgroundImage: "repeating-linear-gradient(45deg, var(--chart-2) 0 1px, transparent 1px 6px)" };

function ContributionStrip({ value }: { value: DiagnosisValue }) {
  const head = value.ranked.slice(0, 5);
  const tail = value.ranked.slice(5);
  if (head.length === 0) {
    return <div role="img" aria-label="excluded by the health gate" className="h-1.5 rounded-xs" style={hatch} />;
  }
  const label = [...head.map((r) => `${r.sensor} ${formatNumber(r.contribution)}`), ...(tail.length ? [`and ${tail.length} more`] : [])].join(", ");
  return (
    <div role="img" aria-label={label} className="flex h-1.5 gap-px overflow-hidden rounded-xs">
      {head.map((r, i) => (
        <span key={r.sensor} className={i === 0 ? "bg-foreground" : "bg-chart-3"} style={{ width: `${r.contribution * 100}%` }} />
      ))}
      {tail.length > 0 && <span className="bg-chart-5" style={{ width: `${tail.reduce((sum, r) => sum + r.contribution, 0) * 100}%` }} />}
    </div>
  );
}

export function IncidentCard({ incident, selected, label }: { incident: DiagnosisInference; selected: boolean; label: (sample: number) => string }) {
  const { value } = incident;
  const { hash } = useLocation();
  const targeted = selected && hash !== "";
  const ref = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (targeted) ref.current?.scrollIntoView({ block: "nearest" });
  }, [targeted]);
  const others = (value.ranked.length || value.excluded.length) - 1;

  return (
    <Link
      ref={ref}
      to={{ hash: `#${incident.id}` }}
      replace
      aria-current={selected ? "true" : undefined}
      className="block rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <Card size="sm" className={cn("h-full gap-2", selected && "ring-foreground")}>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-baseline gap-x-1.5">
            <span className="font-mono">{incident.sensor}</span>
            {others > 0 && <span className="text-xs font-normal text-muted-foreground">and {others} more</span>}
          </CardTitle>
          <CardDescription>
            <FaultBadge faultClass={value.faultClass} />
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <p className="flex items-center justify-between gap-2 font-mono text-xs text-muted-foreground tabular-nums">
            <span>
              {value.onset === null ? (
                "onset not located"
              ) : (
                <>
                  since <span className="text-foreground">{label(value.onset)}</span>
                </>
              )}
            </span>
            <WindowTrack window={value.window} name={`window ${label(value.window.from)} to ${label(value.window.to)}`} />
          </p>
          <ContributionStrip value={value} />
          <div className="flex items-center justify-between gap-2">
            <StatusBadge kind={incident.status} />
            <ConfidenceBar value={incident.confidence} />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
