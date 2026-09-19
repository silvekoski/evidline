import { ChevronRightIcon } from "lucide-react";
import type { Lens, SensorReport } from "@tpm/schemas";
import { EvidenceChip } from "@/components/evidence-chip";
import { AliasChip } from "./alias-chip";

export function StructureStrip({ report, current, lens }: { report: SensorReport; current: string | null; lens: Lens }) {
  return (
    <div className="mb-4 grid gap-3 rounded-lg border p-3 text-sm md:grid-cols-2">
      <section aria-labelledby="redundancy-groups" className="flex flex-col gap-2">
        <h2 id="redundancy-groups" className="text-xs font-medium text-muted-foreground">
          Redundancy groups
        </h2>
        {report.redundancyGroups.length === 0 ? (
          <p className="text-muted-foreground">No group. No two {lens.sensors} agree above the redundancy threshold at lag zero.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {report.redundancyGroups.map((group) => (
              <li key={group.evidenceId} className="flex flex-wrap items-center gap-1">
                {group.sensors.map((alias) => (
                  <AliasChip key={alias} alias={alias} current={alias === current} />
                ))}
                <EvidenceChip evidenceId={group.evidenceId} className="ml-1" />
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="flow-order" className="flex flex-col gap-2">
        <h2 id="flow-order" className="text-xs font-medium text-muted-foreground">
          Flow order, upstream first
        </h2>
        {report.flowOrder.length === 0 ? (
          <p className="text-muted-foreground">No order. The relation graph found no directed edge.</p>
        ) : (
          <ol className="flex flex-wrap items-center gap-1">
            {report.flowOrder.map((alias, i) => (
              <li key={alias} className="flex items-center gap-1">
                {i > 0 && <ChevronRightIcon className="size-3 text-muted-foreground" aria-hidden="true" />}
                <AliasChip alias={alias} current={alias === current} />
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
