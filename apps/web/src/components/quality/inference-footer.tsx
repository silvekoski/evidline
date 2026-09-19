import type { Inference } from "@tpm/schemas";
import { ActionBar } from "@/components/action-bar";
import { ConfidenceBar } from "@/components/confidence-bar";
import { EvidenceChip } from "@/components/evidence-chip";

export function EvidenceChips({ ids }: { ids: string[] }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {ids.map((id) => (
        <EvidenceChip key={id} evidenceId={id} />
      ))}
    </span>
  );
}

export function InferenceFooter({ inference }: { inference: Inference }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <ConfidenceBar value={inference.confidence} />
        <EvidenceChips ids={inference.evidenceIds} />
      </div>
      <ActionBar inference={inference} />
    </div>
  );
}
