import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LoaderIcon } from "lucide-react";
import { cn } from "cn";
import type { SensorRow } from "@tpm/schemas";
import { getModelSettings, getNameChecks, keys, requestNameCheck } from "@/api";
import { shortModel, supportOf, VoteHeader, VoteRow, VoteTally, type VoteChip } from "@/components/model-vote";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useActiveRunId } from "@/hooks/use-active-run-id";
import { ModelLogo } from "./model-logo";
import { useOpenSensor } from "./use-open-sensor";


export function NameCheckMarks({ checks, roleInferenceId }: { checks: SensorRow["nameChecks"]; roleInferenceId: string }) {
  const open = useOpenSensor();
  if (checks.length === 0) return null;
  const agree = checks.filter((c) => c.agrees === true).length;
  const label = `AI vote, ${agree} of ${checks.length} models gave this name: ${checks.map((c) => `${shortModel(c.model)} ${c.agrees === true ? "agrees" : c.agrees === false ? "differs" : "no answer"}${c.name ? ` (${c.name})` : ""}`).join(", ")}. Open to see the full vote.`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-sm font-mono text-xs text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          aria-label={label}
          onClick={(event) => {
            event.stopPropagation();
            open(roleInferenceId);
          }}
        >
          <span className="inline-flex items-center gap-0.5">
            {checks.map((c) => (
              <span
                key={c.model}
                aria-hidden="true"
                className={cn(
                  "inline-flex size-4 items-center justify-center rounded-sm border",
                  c.agrees === true && "border-foreground text-foreground",
                  c.agrees === false && "border-dashed opacity-60",
                  c.agrees === null && "opacity-40",
                )}
              >
                <ModelLogo model={c.model} className="size-3" />
              </span>
            ))}
          </span>
          <span className="ml-0.5">
            {agree}/{checks.length}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{label}</TooltipContent>
    </Tooltip>
  );
}

const chipOf = (agrees: boolean | null): VoteChip => (agrees === true ? { text: "Same name", variant: "default" } : agrees === false ? { text: "Other name", variant: "outline" } : { text: "No answer", variant: "secondary" });

const answerOf = (name: string | null, quantity: string | null, note: string) =>
  name ? (
    <>
      {name}
      {quantity ? <span className="text-muted-foreground"> ({quantity})</span> : null}
    </>
  ) : (
    <span className="text-muted-foreground">{note}</span>
  );

export function NameCheckPanel({ inferenceId, hypothesis, hypothesisConfidence }: { inferenceId: string; hypothesis: string | null; hypothesisConfidence: number | null }) {
  const queryClient = useQueryClient();
  const runId = useActiveRunId();
  const [why, setWhy] = useState(false);
  const report = useQuery({ queryKey: keys.nameChecks(inferenceId), queryFn: () => getNameChecks(inferenceId), refetchInterval: (q) => (q.state.data?.pending ? 2000 : false) });
  const settings = useQuery({ queryKey: keys.modelSettings, queryFn: getModelSettings, staleTime: 60_000 });
  const run = useMutation({ mutationFn: () => requestNameCheck(inferenceId), onSuccess: () => void queryClient.invalidateQueries() });
  const checks = report.data?.checks ?? [];
  const primary = report.data?.primary ?? null;
  const pending = report.data?.pending ?? null;
  const waiting = pending ? (settings.data?.reviewers.map((r) => r.model) ?? []).filter((m) => !checks.some((c) => c.model === m)) : [];
  const voters = [...(primary ? [primary] : []), ...checks];
  const answered = voters.filter((c) => c.name !== null).length;
  const agree = voters.filter((c) => c.agrees === true).length;
  const hasReason = primary?.reason !== null || checks.some((c) => c.reason);
  const support = supportOf(agree, answered);
  return (
    <section aria-labelledby={`checks-${inferenceId}`} className="flex flex-col gap-2">
      <VoteHeader
        id={`checks-${inferenceId}`}
        question="Which name do the models agree on?"
        hint="Blind vote. Each reviewer gets the same statistics and names the sensor on its own. No reviewer sees the primary name. The name that most models share wins."
        hasReason={hasReason}
        why={why}
        onWhy={() => setWhy((v) => !v)}
        action={checks.length ? "Ask the models again" : "Ask other models"}
        disabled={run.isPending || pending !== null}
        onAsk={() => run.mutate()}
      />
      {run.isError && <p className="text-xs">{run.error.message}</p>}
      {pending && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
          <LoaderIcon aria-hidden="true" className="size-3.5 shrink-0 motion-safe:animate-spin" />
          <Progress value={(pending.done / pending.total) * 100} className="h-1.5 flex-1" aria-label="Reviewers answered" />
          <span className="shrink-0 tabular-nums">
            {pending.done}/{pending.total}
          </span>
        </div>
      )}
      {checks.length > 0 && <VoteTally agree={agree} total={voters.length} sentence={`${agree === 1 ? "model names" : "models name"} ${report.data?.name ?? "nothing"}. ${support}${support === "Strong support." ? "" : " Treat the name as a guess."}`} />}
      <ul className="flex flex-col" aria-label="Names by model">
        {(primary || hypothesis) && (
          <VoteRow
            model={primary?.model ?? ""}
            answer={answerOf(primary?.name ?? hypothesis, primary?.quantity ?? null, "no hypothesis (model off)")}
            confidence={primary?.confidence ?? hypothesisConfidence}
            chip={primary?.agrees === false ? { text: "Outvoted", variant: "secondary" } : { text: "Primary", variant: "outline" }}
            runId={runId}
            egressId={primary?.egressId ?? null}
            time={primary?.time ?? null}
            reason={primary?.reason}
            why={why}
          />
        )}
        {checks.map((c) => (
          <VoteRow key={c.model} model={c.model} answer={answerOf(c.name, c.quantity, c.error ?? "no answer")} confidence={c.confidence} chip={chipOf(c.agrees)} runId={runId} egressId={c.egressId} time={c.time} reason={c.reason} why={why} />
        ))}
        {waiting.map((model) => {
          const active = pending?.model === model;
          return (
            <VoteRow
              key={model}
              model={model}
              answer={
                <span className={cn("inline-flex items-center gap-1.5", active ? "text-foreground" : "text-muted-foreground")}>
                  {active && <LoaderIcon aria-hidden="true" className="size-3.5 motion-safe:animate-spin" />}
                  {active ? "answering now" : "queued"}
                </span>
              }
              confidence={null}
              chip={{ text: active ? "Answering" : "Queued", variant: "secondary" }}
              runId={runId}
              egressId={null}
              time={null}
              reason={null}
              why={why}
            />
          );
        })}
        {checks.length === 0 && waiting.length === 0 && <li className="py-2 text-xs text-muted-foreground">No vote yet. Ask other models for an independent name from each reviewer.</li>}
      </ul>
    </section>
  );
}
