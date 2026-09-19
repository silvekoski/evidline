import type { ReactNode } from "react";
import type { EgressTotals } from "@tpm/schemas";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatBytes } from "@/lib/format";

const count = (n: number) => n.toLocaleString("en-US");

function bytesRatio(totals: EgressTotals): string {
  if (totals.sentBytes === 0) return "nothing left";
  if (totals.rawBytes === 0) return "no raw data";
  return `1 : ${count(Math.round(totals.rawBytes / totals.sentBytes))}`;
}

function Stat({ label, children, detail, className }: { label: string; children: ReactNode; detail?: ReactNode; className?: string }) {
  return (
    <Card size="sm" className={className}>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="font-mono text-xl tabular-nums">{children}</CardTitle>
      </CardHeader>
      {detail !== undefined && <CardContent className="text-xs text-muted-foreground">{detail}</CardContent>}
    </Card>
  );
}

export function TotalsCards({ totals, plant }: { totals: EgressTotals; plant: string }) {
  const errors = totals.calls - totals.sent - totals.blocked - totals.off;
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[2fr_repeat(5,minmax(0,1fr))_2fr]">
      <Card size="sm" className="sm:col-span-2 xl:col-span-1">
        <CardHeader>
          <CardDescription>Bytes</CardDescription>
          <CardTitle className="flex flex-wrap items-baseline gap-x-4 gap-y-1 font-mono text-xl tabular-nums">
            <span>
              <span className="mr-1.5 font-sans text-xs font-normal text-muted-foreground">raw in the {plant}</span>
              {formatBytes(totals.rawBytes)}
            </span>
            <span>
              <span className="mr-1.5 font-sans text-xs font-normal text-muted-foreground">sent</span>
              {formatBytes(totals.sentBytes)}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground">
          ratio <span className="font-mono text-foreground tabular-nums">{bytesRatio(totals)}</span>
        </CardContent>
      </Card>
      <Stat label="Calls" detail={errors > 0 ? `${count(errors)} with an error` : "the table below lists every record"}>
        {count(totals.calls)}
      </Stat>
      <Stat label="Sent" detail="reached a model">
        {count(totals.sent)}
      </Stat>
      <Stat label="Blocked" detail="stopped by a guard">
        {count(totals.blocked)}
      </Stat>
      <Stat label="Off" detail="answered by a template">
        {count(totals.off)}
      </Stat>
      <Stat label="Scanner hits" detail={totals.scannerHits === 0 ? "no raw value in any payload" : "payloads with a raw value or a name"}>
        {count(totals.scannerHits)}
        <span className="ml-2 font-sans text-sm font-normal">{totals.scannerHits === 0 ? "zero" : totals.scannerHits === 1 ? "hit" : "hits"}</span>
      </Stat>
      <Stat label="Outbound hosts" detail={totals.hosts.length === 0 ? "no host received data" : <span className="font-mono break-all">{totals.hosts.join(", ")}</span>} className="sm:col-span-2 xl:col-span-1">
        {count(totals.hosts.length)}
      </Stat>
    </div>
  );
}
