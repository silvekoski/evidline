import { ChartLineIcon, CheckIcon, FileTextIcon, SparklesIcon, XIcon } from "lucide-react";
import type { DiagnosisValue } from "@tpm/schemas";
import { openEvidence } from "@/hooks/use-evidence-sheet";

export function DiagnosisProse({ prose }: { prose: DiagnosisValue["prose"] }) {
  if (!prose) {
    return <p className="text-sm text-muted-foreground">No prose yet. The reasoning steps carry the diagnosis.</p>;
  }
  const { source, validation } = prose;
  const SourceIcon = source === "model" ? SparklesIcon : FileTextIcon;
  const ValidIcon = validation.pass ? CheckIcon : XIcon;
  const errors = validation.errors.length;
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-sm leading-7">
        {validation.sentences.length === 0 && prose.text}
        {validation.sentences.map((sentence, i) => {
          const first = sentence.evidenceIds[0];
          return first === undefined ? (
            <span key={i}>{sentence.text} </span>
          ) : (
            <button
              key={i}
              type="button"
              onClick={() => openEvidence(first)}
              className="group/sentence mr-1 inline rounded-sm text-left underline-offset-4 hover:underline hover:decoration-dotted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              aria-label={`${sentence.text} Open evidence ${first}`}
            >
              {sentence.text}
              <ChartLineIcon aria-hidden="true" className="mb-0.5 ml-1 inline size-3 text-muted-foreground group-hover/sentence:text-foreground" />
            </button>
          );
        })}
      </p>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <SourceIcon aria-hidden="true" className="size-3" />
          {source === "model" ? "Model prose" : "Template prose"}
        </span>
        <span className="inline-flex items-center gap-1">
          <ValidIcon aria-hidden="true" className="size-3" />
          {validation.pass ? "Validator passed" : `Validator failed, ${errors} error${errors === 1 ? "" : "s"}`}
        </span>
      </p>
      {errors > 0 && (
        <ul className="list-disc pl-5 text-xs text-muted-foreground">
          {validation.errors.map((error, i) => (
            <li key={i}>{error}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
