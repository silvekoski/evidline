import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef, ExpandedState, OnChangeFn } from "@tanstack/react-table";
import type { Rule } from "@tpm/schemas";
import { getInference, keys } from "@/api";
import { EvidenceChip } from "@/components/evidence-chip";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useLens } from "@/hooks/use-lens";
import { capitalize } from "@/lib/format";
import { DataTable, expandColumn } from "./data-table";
import { InferenceFooter } from "./inference-footer";
import { useActivateRule } from "./use-activate-rule";

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
  expanded,
  onExpandedChange,
  targetId,
}: {
  rules: Rule[];
  expanded: ExpandedState;
  onExpandedChange: OnChangeFn<ExpandedState>;
  targetId: string | null;
}) {
  const lens = useLens();
  const { mutate, isPending: pending, variables } = useActivateRule();
  const columns = useMemo<ColumnDef<Rule>[]>(
    () => [
      expandColumn((r) => `Details of rule ${r.id}`),
      {
        accessorKey: "origin",
        header: "Origin",
        cell: ({ row }) => <Badge variant="outline">{row.original.origin === "operator" ? lens.operator : "baseline"}</Badge>,
      },
      { accessorKey: "restated", header: "Rule", meta: { className: "whitespace-normal" } },
      { id: "sensor", accessorFn: (r) => r.rule.sensor, header: capitalize(lens.sensor), cell: ({ row }) => <span className="font-mono">{row.original.rule.sensor}</span> },
      { id: "type", accessorFn: (r) => r.rule.type, header: "Type" },
      { accessorKey: "violations", header: "Violations", meta: { numeric: true }, cell: ({ row }) => row.original.violations.toLocaleString("en-US") },
      { id: "evidence", header: "Evidence", enableSorting: false, cell: ({ row }) => <EvidenceChip evidenceId={row.original.evidenceId} /> },
      {
        id: "active",
        accessorFn: (r) => (r.active ? 1 : 0),
        header: "Active",
        cell: ({ row }) => {
          const rule = row.original;
          return (
            <Switch
              checked={rule.active}
              disabled={rule.active || (pending && variables === rule.id)}
              onCheckedChange={(on) => on && mutate(rule.id)}
              aria-label={rule.active ? `Rule ${rule.id} is active` : `Activate rule ${rule.id}`}
            />
          );
        },
      },
    ],
    [lens.operator, lens.sensor, mutate, pending, variables],
  );

  return (
    <DataTable
      label="Rules"
      columns={columns}
      data={rules}
      getRowId={(r) => r.inferenceId}
      initialSorting={[{ id: "violations", desc: true }]}
      expanded={expanded}
      onExpandedChange={onExpandedChange}
      rowProps={(row) => ({ id: row.id, tabIndex: row.id === targetId ? -1 : undefined, "data-state": row.id === targetId ? "selected" : undefined })}
      renderExpanded={(row) => (
        <div className="flex flex-col gap-3">
          <RuleJsonBlock rule={row.original} />
          <RuleInference id={row.original.inferenceId} />
        </div>
      )}
      empty="No rules yet. Write one as a sentence."
    />
  );
}
