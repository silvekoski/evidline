import { useQuery } from "@tanstack/react-query";
import { CheckIcon } from "lucide-react";
import { cn } from "cn";
import { Role, type SensorDetail } from "@tpm/schemas";
import { getInference, keys } from "@/api";
import { ActionBar } from "@/components/action-bar";
import { ConfidenceBar } from "@/components/confidence-bar";
import { EvidenceChip } from "@/components/evidence-chip";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Hypothesis } from "./hypothesis";

export function RolesTab({ detail }: { detail: SensorDetail }) {
  const inference = useQuery({ queryKey: keys.inference(detail.roleInferenceId), queryFn: () => getInference(detail.roleInferenceId) });
  const scores = Role.options.map((role) => ({ role, score: detail.roleScores[role] ?? 0 })).sort((a, b) => b.score - a.score);
  const [first, second] = scores;
  const hypothesisConfidence = inference.data?.stage === "role" ? inference.data.value.hypothesisConfidence : null;
  return (
    <div className="flex flex-col gap-5">
      <section aria-labelledby="role-inference" className="flex flex-col gap-2">
        <h3 id="role-inference" className="text-xs font-medium text-muted-foreground">
          Role inference <span className="font-mono">{detail.roleInferenceId}</span>
        </h3>
        {inference.data ? (
          <>
            <p>{inference.data.claim}</p>
            <ConfidenceBar value={inference.data.confidence} />
            <ul className="flex flex-wrap gap-1" aria-label="Evidence">
              {inference.data.evidenceIds.map((id) => (
                <li key={id}>
                  <EvidenceChip evidenceId={id} />
                </li>
              ))}
            </ul>
            <ActionBar inference={inference.data} />
          </>
        ) : inference.isError ? (
          <p className="text-muted-foreground">{inference.error.message}</p>
        ) : (
          <Skeleton className="h-20 w-full" />
        )}
      </section>
      <section aria-labelledby="role-scores" className="flex flex-col gap-2">
        <h3 id="role-scores" className="text-xs font-medium text-muted-foreground">
          Role scores
        </h3>
        <ol className="flex flex-col gap-1.5">
          {scores.map(({ role, score }) => {
            const winner = role === detail.role;
            return (
              <li key={role} className="grid grid-cols-[7rem_1fr_3rem_5rem] items-center gap-2 text-sm">
                <span className={cn(winner && "font-medium")}>{role}</span>
                <Progress value={score * 100} aria-label={`${role} score`} className={cn("h-2", winner && "outline outline-1 outline-offset-1 outline-foreground")} />
                <span className="text-right font-mono text-xs tabular-nums">{score.toFixed(2)}</span>
                <span className="inline-flex items-center gap-1 text-xs">
                  {winner && (
                    <>
                      <CheckIcon className="size-3" aria-hidden="true" />
                      winner
                    </>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
        <p className="text-xs text-muted-foreground">
          {first && second
            ? `Winner ${detail.role}. Best score ${first.role} ${first.score.toFixed(2)}, second ${second.role} ${second.score.toFixed(2)}, margin ${(first.score - second.score).toFixed(2)}. Confidence is the margin, reduced for missing data.`
            : "No score."}
        </p>
      </section>
      <section aria-labelledby="role-hypothesis" className="flex flex-col gap-2">
        <h3 id="role-hypothesis" className="text-xs font-medium text-muted-foreground">
          Physical name
        </h3>
        <div className="flex flex-wrap items-center gap-3">
          <Hypothesis name={detail.hypothesisName} />
          {hypothesisConfidence !== null && <ConfidenceBar value={hypothesisConfidence} />}
        </div>
        <p className="text-xs text-muted-foreground">The model proposes the name from the fingerprint summary. No later stage reads it, so a wrong name cannot cause a wrong diagnosis.</p>
      </section>
    </div>
  );
}
