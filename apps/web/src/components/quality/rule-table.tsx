import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef, ExpandedState, OnChangeFn } from "@tanstack/react-table";
import { PlayIcon } from "lucide-react";
import { toast } from "sonner";
import type { Rule } from "@tpm/schemas";
import { activateRule, getInference, keys } from "@/api";
import { EvidenceChip } from "@/components/evidence-chip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useLens } from "@/hooks/use-lens";
import { capitalize } from "@/lib/format";
import { DataTable, expandColumn } from "@/components/data-table";
import { InferenceFooter } from "./inference-footer";
import { percent } from "./signal-lane";

type Filter = "all" | "operator" | "baseline" | "active";

export function RuleJsonBlock({ rule }: { rule: Rule }) {
  return (
    <pre className="overflow-x-auto rounded-md bg-muted p-2 font-mono text-xs" aria-label={`Rule JSON of ${rule.id}`}>
      {JSON.stringify(rule.rule, null, 2)}
    </pre>
  );
}

function RuleInference({ id }: { id: string }) {
  const inference = useQuery({ queryKey: keys.inference(id), queryFn: () => getInference(id) });
  if (inference.isPending) return <Skeleton className="h-8 w-64" />;
  if (inference.isError) return <p className="text-muted-foreground">{inference.error.message}</p>;
  return <InferenceFooter inference={inference.data} />;
}

export function RuleTable({
  rules,
  gridSize,
  expanded,
  onExpandedChange,
  targetId,
}: {
  rules: Rule[];
  gridSize: number;
  expanded: ExpandedState;
  onExpandedChange: OnChangeFn<ExpandedState>;
  targetId: string | null;
}) {
  const lens = useLens();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const activate = useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) await activateRule(id);
      return ids.length;
    },
    onSuccess: (count) => {
      setSelected(new Set());
      toast.success(count === 1 ? "Rule activated" : `${count} rules activated`);
      void queryClient.invalidateQueries();
    },
  });
  const counts = {
    all: rules.length,
    operator: rules.filter((r) => r.origin === "operator").length,
    baseline: rules.filter((r) => r.origin === "baseline").length,
    active: rules.filter((r) => r.active).length,
  };
  const visible = rules.filter((r) => (filter === "all" ? true : filter === "active" ? r.active : r.origin === filter));
  const selectable = visible.filter((r) => !r.active);
  const allSelected = selectable.length > 0 && selectable.every((r) => selected.has(r.id));

  const columns = useMemo<ColumnDef<Rule>[]>(
    () => [
      {
        id: "select",
        enableSorting: false,
        meta: { className: "w-8 pr-0" },
        header: () => (
          <Checkbox
            checked={allSelected ? true : selectable.some((r) => selected.has(r.id)) ? "indeterminate" : false}
            disabled={selectable.length === 0}
            onCheckedChange={(on) => setSelected(on === true ? new Set(selectable.map((r) => r.id)) : new Set())}
            aria-label="Select all inactive rules in view"
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={selected.has(row.original.id)}
            disabled={row.original.active}
            onCheckedChange={(on) =>
              setSelected((s) => {
                const next = new Set(s);
                if (on === true) next.add(row.original.id);
                else next.delete(row.original.id);
                return next;
              })
            }
            aria-label={`Select rule ${row.original.id}`}
          />
        ),
      },
      expandColumn((r) => `Details of rule ${r.id}`),
      {
        accessorKey: "restated",
        header: "Rule",
        meta: { className: "whitespace-normal" },
        cell: ({ row }) => (
          <span className="inline-flex flex-wrap items-center gap-2">
            {row.original.restated}
            {row.original.origin === "operator" && <Badge variant="outline">{lens.operator}</Badge>}
          </span>
        ),
      },
      { id: "sensor", accessorFn: (r) => r.rule.sensor, header: lens.sensor, cell: ({ row }) => <span className="font-mono text-xs text-muted-foreground">{row.original.rule.sensor}</span> },
      {
        accessorKey: "violations",
        header: "Violations",
        meta: { numeric: true },
        cell: ({ row }) => {
          const share = gridSize === 0 ? 0 : row.original.violations / gridSize;
          return (
            <span className="inline-flex items-center gap-2" title={`${row.original.violations.toLocaleString("en-US")} of ${gridSize.toLocaleString("en-US")} samples`}>
              <span className="relative inline-block h-2 w-16 rounded-xs bg-muted" aria-hidden="true">
                <span className="absolute inset-y-0 left-0 rounded-xs bg-foreground" style={{ width: `${Math.min(100, share * 100)}%` }} />
              </span>
              <span className="w-12 text-right">{percent(share)}</span>
            </span>
          );
        },
      },
      { id: "evidence", header: "Evidence", enableSorting: false, cell: ({ row }) => <EvidenceChip evidenceId={row.original.evidenceId} /> },
      {
        id: "active",
        accessorFn: (r) => (r.active ? 1 : 0),
        header: "Active",
        cell: ({ row }) =>
          row.original.active ? (
            <Badge variant="default">active</Badge>
          ) : (
            <Button size="xs" variant="ghost" className="-ml-2 text-muted-foreground" onClick={() => activate.mutate([row.original.id])} disabled={activate.isPending}>
              <PlayIcon aria-hidden="true" />
              Activate
            </Button>
          ),
      },
    ],
    [lens.operator, lens.sensor, gridSize, selected, selectable, allSelected, activate],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ToggleGroup type="single" variant="outline" size="sm" spacing={0} value={filter} onValueChange={(v) => v && setFilter(v as Filter)} aria-label="Show rules">
          {(["all", "operator", "baseline", "active"] as const).map((f) => (
            <ToggleGroupItem key={f} value={f}>
              {capitalize(f === "operator" ? lens.operator : f)} <span className="font-mono tabular-nums">{counts[f]}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {selected.size > 0 && (
          <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-2 py-1 text-sm" role="region" aria-live="polite" aria-label="Selection">
            <span className="tabular-nums">{selected.size} selected</span>
            <Button size="sm" onClick={() => activate.mutate([...selected])} disabled={activate.isPending}>
              <PlayIcon aria-hidden="true" />
              Activate
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </div>
        )}
      </div>
      <DataTable
        label="Rules"
        columns={columns}
        data={visible}
        getRowId={(r) => r.inferenceId}
        initialSorting={[{ id: "sensor", desc: false }]}
        expanded={expanded}
        onExpandedChange={onExpandedChange}
        rowProps={(row) => ({ id: row.id, tabIndex: row.id === targetId ? -1 : undefined, "data-state": row.id === targetId || selected.has(row.original.id) ? "selected" : undefined })}
        renderExpanded={(row) => (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              {row.original.violations.toLocaleString("en-US")} violations in {gridSize.toLocaleString("en-US")} samples.
            </p>
            <RuleJsonBlock rule={row.original} />
            <RuleInference id={row.original.inferenceId} />
          </div>
        )}
        empty={filter === "all" ? "No rules yet. Write one as a sentence." : "No rules in this view."}
      />
    </div>
  );
}
