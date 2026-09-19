import type { Inference } from "@tpm/schemas";
import { ActionBar } from "@/components/action-bar";
import { ConfidenceBar } from "@/components/confidence-bar";
import { EvidenceChip } from "@/components/evidence-chip";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function EvidenceChips({ ids, max = ids.length }: { ids: string[]; max?: number }) {
  const shown = ids.slice(0, max);
  const rest = ids.slice(max);
  return (
    <span className="inline-flex flex-wrap gap-1">
      {shown.map((id) => (
        <EvidenceChip key={id} evidenceId={id} />
      ))}
      {rest.length > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <Badge asChild variant="outline" className="cursor-pointer font-mono font-normal hover:bg-muted">
              <button type="button" aria-label={`${rest.length} more evidence records`}>+{rest.length}</button>
            </Badge>
          </PopoverTrigger>
          <PopoverContent align="start" className="flex w-auto max-w-80 flex-wrap gap-1 p-2">
            {rest.map((id) => (
              <EvidenceChip key={id} evidenceId={id} />
            ))}
          </PopoverContent>
        </Popover>
      )}
    </span>
  );
}

export function InferenceFooter({ inference }: { inference: Inference }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <ConfidenceBar value={inference.confidence} />
        <EvidenceChips ids={inference.evidenceIds} max={6} />
      </div>
      <ActionBar inference={inference} />
    </div>
  );
}
