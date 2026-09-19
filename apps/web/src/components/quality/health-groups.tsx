import { Fragment, useEffect, useMemo, useState } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { cn } from "cn";
import { faultLabel, healthToFault, type BaselineInference, type HealthClass, type HealthInference, type LaneReport, type Run } from "@tpm/schemas";
import { StatusBadge, healthKind } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useLens } from "@/hooks/use-lens";
import { capitalize, formatNumber } from "@/lib/format";
import { HealthDetail } from "./health-detail";
import { EvidenceChips } from "./inference-footer";
import { DensityLane, SignalLane, maskShare, percent, type LaneScale } from "./signal-lane";

export type HealthFilter = "all" | "failed" | "healthy";

type Cluster = { key: string; rows: HealthInference[]; share: number };
type Group = { health: "healthy" | HealthClass; rows: HealthInference[]; clusters: Cluster[]; share: number };

const columns = 8;
const signature = (h: HealthInference) => h.value.masked.map((m) => `${m.from}-${m.to}`).join(",");

function groupChecks(checks: HealthInference[], gridSize: number): Group[] {
  const byHealth = new Map<"healthy" | HealthClass, HealthInference[]>();
  for (const h of checks) byHealth.set(h.value.health, [...(byHealth.get(h.value.health) ?? []), h]);
  const groups = [...byHealth.entries()].map(([health, rows]) => {
    const byShare = new Map(rows.map((h) => [h.id, maskShare(h.value.masked, gridSize)]));
    const sorted = [...rows].sort((a, b) => byShare.get(b.id)! - byShare.get(a.id)! || a.value.sensor.localeCompare(b.value.sensor));
    const clusters = new Map<string, HealthInference[]>();
    for (const h of sorted) clusters.set(signature(h), [...(clusters.get(signature(h)) ?? []), h]);
    return {
      health,
      rows: sorted,
      clusters: [...clusters.entries()].map(([key, members]) => ({ key: `${health}:${key}`, rows: members, share: byShare.get(members[0]!.id)! })),
      share: maskShare(rows.flatMap((h) => h.value.masked), gridSize),
    };
  });
  return groups.sort((a, b) => (a.health === "healthy" ? 1 : b.health === "healthy" ? -1 : b.rows.length - a.rows.length));
}

const compact = (sample: number) => (sample >= 1000 ? `${Math.round(sample / 1000)}k` : String(sample));

function Axis({ scale, label }: { scale: LaneScale; label: ((sample: number) => string) | null }) {
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * scale.gridSize));
  const tick = (t: number, last: boolean) => (label ? label(t) : last ? t.toLocaleString("en-US") : compact(t));
  return (
    <div className="flex flex-col gap-0.5 font-normal">
      <div className="relative h-4 border-b border-border" aria-hidden="true">
        {ticks.map((t, i) => (
          <span key={t} className={cn("absolute bottom-0 font-mono text-[10px] text-muted-foreground", i === 0 ? "" : i === ticks.length - 1 ? "-translate-x-full" : "-translate-x-1/2")} style={{ left: `${(t / scale.gridSize) * 100}%` }}>
            {tick(t, i === ticks.length - 1)}
          </span>
        ))}
      </div>
      <span className="flex flex-wrap items-center gap-x-3 text-[10px] text-muted-foreground">
        Signal over the run
        <span className="inline-flex items-center gap-1">
          <i className="inline-block h-2 w-3 bg-chart-1/30" aria-hidden="true" /> baseline and its p1 to p99 band
        </span>
        <span className="inline-flex items-center gap-1">
          <i className="inline-block h-2 w-3 bg-chart-2/40" aria-hidden="true" /> masked
        </span>
        <span className="inline-flex items-center gap-1">
          <i className="inline-block h-2.5 border-l border-dashed border-muted-foreground" aria-hidden="true" /> change point
        </span>
      </span>
    </div>
  );
}

function ExpandButton({ open, id, label, onClick }: { open: boolean; id: string; label: string; onClick: () => void }) {
  return (
    <Button variant="ghost" size="icon-xs" aria-expanded={open} aria-controls={open ? `${id}-detail` : undefined} aria-label={label} onClick={onClick}>
      {open ? <ChevronDownIcon aria-hidden="true" /> : <ChevronRightIcon aria-hidden="true" />}
    </Button>
  );
}

export function HealthGroups({
  checks,
  lanes,
  baseline,
  run,
  label,
  day,
  expanded,
  onExpandedChange,
  targetId,
}: {
  checks: HealthInference[];
  lanes: LaneReport | undefined;
  baseline: BaselineInference;
  run: Run;
  label: (sample: number) => string;
  day: ((sample: number) => string) | null;
  expanded: Record<string, boolean>;
  onExpandedChange: (next: Record<string, boolean>) => void;
  targetId: string | null;
}) {
  const lens = useLens();
  const [filter, setFilter] = useState<HealthFilter>("all");
  const [openClusters, setOpenClusters] = useState<Set<string>>(new Set());
  const [healthyOpen, setHealthyOpen] = useState(false);
  const scale: LaneScale = { t: lanes?.t ?? [], gridSize: run.gridSize, changepoints: baseline.value.changepoints, baselineTo: baseline.value.window.to };
  const laneOf = useMemo(() => new Map((lanes?.lanes ?? []).map((l) => [l.sensor, l])), [lanes]);
  const groups = useMemo(() => groupChecks(checks, run.gridSize), [checks, run.gridSize]);
  const failed = checks.filter((h) => h.value.health !== "healthy").length;

  useEffect(() => {
    if (!targetId) return;
    for (const group of groups) {
      const cluster: Cluster | undefined = group.clusters.find((c) => c.rows.some((h) => h.id === targetId));
      if (!cluster) continue;
      if (group.health === "healthy") setHealthyOpen(true);
      if (cluster.rows[0]?.id !== targetId) setOpenClusters((s) => (s.has(cluster.key) ? s : new Set(s).add(cluster.key)));
    }
  }, [targetId, groups]);

  const toggleRow = (id: string) => onExpandedChange({ ...expanded, [id]: !expanded[id] });
  const visible = groups.filter((g) => (filter === "all" ? true : filter === "healthy" ? g.health === "healthy" : g.health !== "healthy"));

  return (
    <div className="flex flex-col gap-3">
      <ToggleGroup type="single" variant="outline" size="sm" spacing={0} value={filter} onValueChange={(v) => v && setFilter(v as HealthFilter)} aria-label="Show">
        <ToggleGroupItem value="all">
          All <span className="font-mono tabular-nums">{checks.length}</span>
        </ToggleGroupItem>
        <ToggleGroupItem value="failed">
          Failed <span className="font-mono tabular-nums">{failed}</span>
        </ToggleGroupItem>
        <ToggleGroupItem value="healthy">
          Healthy <span className="font-mono tabular-nums">{checks.length - failed}</span>
        </ToggleGroupItem>
      </ToggleGroup>
      <Table aria-label={`Health gate per ${lens.sensor}`}>
        <TableHeader>
          <TableRow>
            <TableHead scope="col" className="h-8 w-8 pr-0">
              <span className="sr-only">Details</span>
            </TableHead>
            <TableHead scope="col" className="h-8">{capitalize(lens.sensor)}</TableHead>
            <TableHead scope="col" className="h-8">Health</TableHead>
            <TableHead scope="col" className="h-auto w-[36%] py-1 align-bottom">
              <Axis scale={scale} label={day} />
            </TableHead>
            <TableHead scope="col" className="h-8 text-right">Masked</TableHead>
            <TableHead scope="col" className="h-8">Failed check</TableHead>
            <TableHead scope="col" className="h-8">Evidence</TableHead>
            <TableHead scope="col" className="h-8">Status</TableHead>
          </TableRow>
        </TableHeader>
        {visible.length === 0 && (
          <TableBody>
            <TableRow>
              <TableCell colSpan={columns} className="py-4 text-center text-muted-foreground">
                No {lens.sensors} in this view.
              </TableCell>
            </TableRow>
          </TableBody>
        )}
        {visible.map((group) => {
          const healthy = group.health === "healthy";
          const open = !healthy || healthyOpen || filter === "healthy";
          const kind = healthKind(group.health);
          const name = group.health === "healthy" ? "Healthy" : faultLabel(healthToFault(group.health));
          return (
            <TableBody key={group.health}>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableCell colSpan={3} className="py-1.5">
                  {healthy ? (
                    <Button variant="ghost" size="sm" className="-ml-2 h-7" aria-expanded={open} onClick={() => setHealthyOpen((v) => !v)}>
                      {open ? <ChevronDownIcon aria-hidden="true" /> : <ChevronRightIcon aria-hidden="true" />}
                      <StatusBadge kind={kind} />
                      <span className="font-mono text-xs text-muted-foreground tabular-nums">{group.rows.length}</span>
                    </Button>
                  ) : (
                    <span className="inline-flex items-center gap-2">
                      <StatusBadge kind={kind} label={name} />
                      <span className="font-mono text-xs text-muted-foreground tabular-nums">{group.rows.length}</span>
                    </span>
                  )}
                </TableCell>
                <TableCell className="py-1.5">
                  {!healthy && <DensityLane scale={scale} rows={group.rows.map((h) => h.value.masked)} description={`Share of ${name} ${lens.sensors} under a mask at each point of the run`} />}
                </TableCell>
                <TableCell className="py-1.5 text-right font-mono text-xs tabular-nums">{percent(group.share)}</TableCell>
                <TableCell colSpan={3} className="py-1.5 text-xs text-muted-foreground">
                  {healthy ? (open ? "all checks pass" : "collapsed") : `${group.clusters.length === 1 ? "one mask pattern" : `${group.clusters.length} mask patterns`}, ${percent(group.share)} of the run under a mask`}
                </TableCell>
              </TableRow>
              {open &&
                group.clusters.map((cluster) => {
                  const [head, ...rest] = cluster.rows;
                  const clusterOpen = openClusters.has(cluster.key);
                  const shown = clusterOpen ? cluster.rows : [head!];
                  return (
                    <Fragment key={cluster.key}>
                      {shown.map((h) => {
                        const targeted = h.id === targetId;
                        const isOpen = expanded[h.id] === true;
                        const failedCheck = h.value.checks.find((c) => !c.pass);
                        const lane = laneOf.get(h.value.sensor);
                        return (
                          <Fragment key={h.id}>
                            <TableRow id={h.id} tabIndex={targeted ? -1 : undefined} data-state={targeted ? "selected" : undefined}>
                              <TableCell className="w-8 py-1 pr-0">
                                <ExpandButton open={isOpen} id={h.id} label={`Details of ${h.value.sensor}`} onClick={() => toggleRow(h.id)} />
                              </TableCell>
                              <TableCell className="py-1 font-mono">{h.value.sensor}</TableCell>
                              <TableCell className="py-1">
                                <StatusBadge kind={healthKind(h.value.health)} label={h.value.health === "healthy" ? undefined : h.value.health} />
                              </TableCell>
                              <TableCell className="py-0.5">
                                <SignalLane
                                  scale={scale}
                                  values={lane?.values}
                                  band={lane?.band}
                                  masks={h.value.masked}
                                  label={label}
                                  description={h.value.masked.length === 0 ? `${h.value.sensor} stays in its baseline band, no mask` : `${h.value.sensor} with ${h.value.masked.length} masked ${h.value.masked.length === 1 ? "window" : "windows"}`}
                                />
                              </TableCell>
                              <TableCell className="py-1 text-right font-mono tabular-nums">{percent(maskShare(h.value.masked, run.gridSize))}</TableCell>
                              <TableCell className="py-1 font-mono text-xs">
                                {failedCheck ? (
                                  <>
                                    {failedCheck.check} <span className="text-muted-foreground">{formatNumber(failedCheck.statistic)} / {formatNumber(failedCheck.threshold)}</span>
                                  </>
                                ) : (
                                  <span className="text-muted-foreground">all pass</span>
                                )}
                              </TableCell>
                              <TableCell className="py-1">
                                <EvidenceChips ids={h.evidenceIds} max={2} />
                              </TableCell>
                              <TableCell className="py-1">
                                <StatusBadge kind={h.status} />
                              </TableCell>
                            </TableRow>
                            {isOpen && (
                              <TableRow id={`${h.id}-detail`} className="hover:bg-transparent">
                                <TableCell colSpan={columns} className="p-3 whitespace-normal">
                                  <HealthDetail inference={h} baseline={baseline} run={run} label={label} />
                                </TableCell>
                              </TableRow>
                            )}
                          </Fragment>
                        );
                      })}
                      {rest.length > 0 && (
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={3} className="py-1">
                            <Button variant="link" size="sm" className="h-7 px-0" aria-expanded={clusterOpen} onClick={() => setOpenClusters((s) => { const next = new Set(s); if (next.has(cluster.key)) next.delete(cluster.key); else next.add(cluster.key); return next; })}>
                              {clusterOpen ? "Hide" : "Show"} {rest.length} more with the same windows
                            </Button>
                          </TableCell>
                          <TableCell className="py-0.5">{!clusterOpen && <SignalLane scale={scale} values={undefined} band={null} masks={head!.value.masked} label={label} description={`Same masked windows as ${head!.value.sensor}`} />}</TableCell>
                          <TableCell className="py-1 text-right font-mono text-xs text-muted-foreground tabular-nums">{percent(cluster.share)}</TableCell>
                          <TableCell colSpan={3} className="py-1 font-mono text-xs whitespace-normal text-muted-foreground">
                            {rest.map((h) => h.value.sensor).join(", ")}
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
            </TableBody>
          );
        })}
      </Table>
    </div>
  );
}
