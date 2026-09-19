import { expandColumn } from "@/components/data-table";
import { formatTimeSeconds } from "@/lib/format";
import { createColumnHelper } from "@tanstack/react-table";
import { Link } from "react-router";
import type { Lens, LogEntry } from "@tpm/schemas";
import { EvidenceChip } from "@/components/evidence-chip";
import { screenPath, type ScreenSlug } from "@/layout/screens";
import { HashCell } from "./hash-cell";


export const actorWord = (actor: LogEntry["actor"], lens: Lens) => (actor === "agent" ? "agent" : lens.operator);

const column = createColumnHelper<LogEntry>();

const idLink = "rounded-sm font-mono text-xs underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";

export function logColumns(runId: string, lens: Lens, screens: Map<string, ScreenSlug>) {
  return [
    expandColumn<LogEntry>((entry) => `Details of entry ${entry.seq}`),
    column.accessor("seq", { header: "Seq", meta: { numeric: true } }),
    column.accessor("time", {
      header: "Time",
      cell: ({ getValue }) => (
        <time dateTime={getValue()} className="font-mono text-xs">
          {formatTimeSeconds(getValue())}
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
