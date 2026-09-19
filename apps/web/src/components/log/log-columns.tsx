import { createColumnHelper } from "@tanstack/react-table";
import { Link } from "react-router";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import type { Lens, LogEntry } from "@tpm/schemas";
import { EvidenceChip } from "@/components/evidence-chip";
import { Button } from "@/components/ui/button";
import { CollapsibleTrigger } from "@/components/ui/collapsible";
import { screenPath, type ScreenSlug } from "@/layout/screens";
import { HashCell } from "./hash-cell";

export type ColumnMeta = { align?: "right"; className?: string };

export const actorWord = (actor: LogEntry["actor"], lens: Lens) => (actor === "agent" ? "agent" : lens.operator);

const column = createColumnHelper<LogEntry>();

const idLink = "rounded-sm font-mono text-xs underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";

export function logColumns(runId: string, lens: Lens, screens: Map<string, ScreenSlug>) {
  return [
    column.display({
      id: "expand",
      header: () => <span className="sr-only">Details</span>,
      meta: { className: "w-8 pr-0" },
      cell: ({ row }) => (
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="icon-xs" aria-label={`Details of entry ${row.original.seq}`}>
            {row.getIsExpanded() ? <ChevronDownIcon aria-hidden="true" /> : <ChevronRightIcon aria-hidden="true" />}
          </Button>
        </CollapsibleTrigger>
      ),
    }),
    column.accessor("seq", { header: "Seq", meta: { align: "right" } }),
    column.accessor("time", {
      header: "Time",
      cell: ({ getValue }) => (
        <time dateTime={getValue()} className="font-mono text-xs">
          {getValue()}
        </time>
      ),
    }),
    column.accessor("type", {
      header: "Type",
      filterFn: (row, id, types: string[]) => types.includes(row.getValue<string>(id)),
    }),
    column.accessor("actor", {
      header: "Actor",
      filterFn: "equals",
      cell: ({ getValue }) => actorWord(getValue(), lens),
    }),
    column.accessor((entry) => entry.inferenceId ?? "", {
      id: "inferenceId",
      header: "Inference",
      cell: ({ getValue }) => {
        const id = getValue();
        const screen = screens.get(id);
        if (id === "") return null;
        return screen ? (
          <Link to={screenPath(runId, screen, id)} className={idLink}>
            {id}
          </Link>
        ) : (
          <span className="font-mono text-xs text-muted-foreground">{id}</span>
        );
      },
    }),
    column.accessor("evidenceIds", {
      header: "Evidence",
      enableSorting: false,
      cell: ({ getValue }) => (
        <span className="flex max-w-72 flex-wrap gap-1">
          {getValue().map((id) => (
            <EvidenceChip key={id} evidenceId={id} />
          ))}
        </span>
      ),
    }),
    column.accessor((entry) => entry.egressId ?? "", {
      id: "egressId",
      header: "Egress",
      cell: ({ getValue }) => {
        const id = getValue();
        return id === "" ? null : (
          <Link to={screenPath(runId, "data-flow", id)} className={idLink}>
            {id}
          </Link>
        );
      },
    }),
    column.accessor((entry) => entry.reason ?? "", {
      id: "reason",
      header: "Reason",
      enableSorting: false,
      meta: { className: "max-w-80 whitespace-normal" },
    }),
    column.accessor("hash", {
      header: "Hash",
      enableSorting: false,
      cell: ({ getValue }) => <HashCell hash={getValue()} />,
    }),
  ];
}
