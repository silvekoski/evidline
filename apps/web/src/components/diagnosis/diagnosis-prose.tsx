import { CheckIcon, FileTextIcon, SparklesIcon, XIcon } from "lucide-react";
import type { DiagnosisValue } from "@tpm/schemas";
import { openEvidence } from "@/hooks/use-evidence-sheet";
import { EvidenceChip } from "@/components/evidence-chip";
import { Badge } from "@/components/ui/badge";

export function DiagnosisProse({ prose }: { prose: DiagnosisValue["prose"] }) {
  if (!prose) {
    return <p className="text-sm text-muted-foreground">No prose yet. The reasoning steps below carry the diagnosis.</p>;
  }
  const { source, validation } = prose;
  const SourceIcon = source === "model" ? SparklesIcon : FileTextIcon;
  const ValidIcon = validation.pass ? CheckIcon : XIcon;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm leading-7">
        {validation.sentences.length === 0 && prose.text}
        {validation.sentences.map((sentence, i) => {
          const first = sentence.evidenceIds[0];
          return (
            <span key={i}>
              {first === undefined ? (
                <span>{sentence.text}</span>
              ) : (
                <button
                  type="button"
                  onClick={() => openEvidence(first)}
                  className="inline rounded-sm text-left underline decoration-dotted underline-offset-4 hover:decoration-solid focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                  aria-label={`${sentence.text} Open evidence ${first}`}
                >
                  {sentence.text}
                </button>
              )}
              {sentence.evidenceIds.map((id) => (
                <EvidenceChip key={id} evidenceId={id} className="mx-0.5 align-middle" />
              ))}{" "}
            </span>
          );
        })}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="font-normal">
          <SourceIcon aria-hidden="true" />
          {source === "model" ? "model prose" : "template prose"}
        </Badge>
        <Badge variant="outline" className="font-normal">
          <ValidIcon aria-hidden="true" />
          {validation.pass ? "validator passed" : `validator failed, ${validation.errors.length} error${validation.errors.length === 1 ? "" : "s"}`}
        </Badge>
      </div>
      {validation.errors.length > 0 && (
        <ul className="list-disc pl-5 text-xs text-muted-foreground">
          {validation.errors.map((error, i) => (
            <li key={i}>{error}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
