import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { cn } from "cn";
import type { NameCheck, NameCheckJob, SensorRow } from "@tpm/schemas";
import { getModelSettings, getNameChecks, keys, requestNameCheck } from "@/api";
import { ConfidenceBar } from "@/components/confidence-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useActiveRunId } from "@/hooks/use-active-run-id";
import { formatTime } from "@/lib/format";
import { Hypothesis } from "./hypothesis";
import { ModelLogo } from "./model-logo";
import { useOpenSensor } from "./use-open-sensor";

export const shortModel = (model: string): string => model.split("/").pop()?.replace(/-Instruct.*$/i, "") ?? model;

export function NameCheckMarks({ checks, roleInferenceId }: { checks: SensorRow["nameChecks"]; roleInferenceId: string }) {
  const open = useOpenSensor();
  if (checks.length === 0) return null;
  const agree = checks.filter((c) => c.agrees === true).length;
  const label = `AI cross-check, ${agree} of ${checks.length} models agree: ${checks.map((c) => `${shortModel(c.model)} ${c.agrees === true ? "agrees" : c.agrees === false ? "differs" : "no answer"}${c.name ? ` (${c.name})` : ""}`).join(", ")}. Open to see the full cross-check.`;
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

type Verdict = { word: string; sentence: string };

function verdictOf(agree: number, answered: number, others: string[]): Verdict {
  const share = answered === 0 ? 0 : agree / answered;
  const word = share >= 0.75 ? "Strong support." : share >= 0.5 ? "Mixed support." : share > 0 ? "Weak support." : "No support.";
  const spread = others.length === 0 ? "" : others.length === 1 ? ` The other reviewers gave ${others[0]}.` : ` The other reviewers gave ${others.length} different names: ${others.join(", ")}.`;
  const advice = share >= 0.75 ? " The name is a good working label." : " Treat the name as a guess.";
  return { word, sentence: `${spread}${advice} No diagnosis depends on it.` };
}

function ReviewerCard({ check, runId }: { check: NameCheck; runId: string | null }) {
  const chip = check.agrees === true ? { text: "Same name", variant: "default" as const } : check.agrees === false ? { text: "Other name", variant: "outline" as const } : { text: "No answer", variant: "secondary" as const };
  return (
    <li className={cn("flex flex-col gap-2 rounded-md border p-3 text-sm", check.agrees === true && "border-foreground", check.agrees === false && "border-dashed")}>
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex min-w-0 items-center gap-2 font-mono text-xs text-muted-foreground" title={check.model}>
          <ModelLogo model={check.model} className="size-5 text-foreground" />
          <span className="truncate">{shortModel(check.model)}</span>
        </span>
        <Badge variant={chip.variant}>{chip.text}</Badge>
      </div>
      {check.name ? (
        <p>
          {check.name}
          {check.quantity ? <span className="text-muted-foreground"> ({check.quantity})</span> : null}
        </p>
      ) : (
        <p className="text-muted-foreground">{check.error ?? "no answer"}</p>
      )}
      {check.confidence !== null && (
        <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
          confidence <ConfidenceBar value={check.confidence} />
        </span>
      )}
      {check.reason && (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Why:</span> {check.reason}
        </p>
      )}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>asked at {formatTime(check.time)}</span>
        {runId && (
          <Link to={{ pathname: `/runs/${runId}/data-flow`, hash: `#${check.egressId}` }} className="underline-offset-4 hover:underline">
            what the model saw and said
          </Link>
        )}
      </div>
    </li>
  );
}

function WaitingCard({ model, job }: { model: string; job: NameCheckJob }) {
  return (
    <li className="flex flex-col gap-2 rounded-md border p-3 text-sm opacity-70" aria-busy="true">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex min-w-0 items-center gap-2 font-mono text-xs text-muted-foreground" title={model}>
          <ModelLogo model={model} className="size-5 text-foreground" />
          <span className="truncate">{shortModel(model)}</span>
        </span>
        <Badge variant="secondary">Waiting</Badge>
      </div>
      <Skeleton className="h-3.5 w-3/5" />
      <Skeleton className="h-3.5 w-2/5" />
      <p className="text-xs text-muted-foreground">
        Call {Math.min(job.done + 1, job.total)} of {job.total} for this run. The answer arrives in a few seconds.
      </p>
    </li>
  );
}

export function NameCheckPanel({ inferenceId, hypothesis, hypothesisConfidence }: { inferenceId: string; hypothesis: string | null; hypothesisConfidence: number | null }) {
  const queryClient = useQueryClient();
  const runId = useActiveRunId();
  const report = useQuery({ queryKey: keys.nameChecks(inferenceId), queryFn: () => getNameChecks(inferenceId), refetchInterval: (q) => (q.state.data?.pending ? 2000 : false) });
  const settings = useQuery({ queryKey: keys.modelSettings, queryFn: getModelSettings, staleTime: 60_000 });
  const run = useMutation({ mutationFn: () => requestNameCheck(inferenceId), onSuccess: () => void queryClient.invalidateQueries() });
  const checks = report.data?.checks ?? [];
  const primary = report.data?.primary ?? null;
  const pending = report.data?.pending ?? null;
  const reviewers = settings.data?.reviewers.map((r) => r.model) ?? [];
  const waiting = pending ? reviewers.filter((m) => !checks.some((c) => c.model === m)) : [];
  const answered = checks.filter((c) => c.name !== null);
  const agree = checks.filter((c) => c.agrees === true).length;
  const others = [...new Set(checks.flatMap((c) => (c.agrees === false && c.name ? [c.name] : [])))];
  const verdict = verdictOf(agree, answered.length, others);
  const reviewerCount = Math.max(reviewers.length, checks.length);
  return (
    <section aria-labelledby={`checks-${inferenceId}`} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`checks-${inferenceId}`} className="inline-flex flex-wrap items-center gap-2 text-sm font-medium">
          Do other models agree with the name?
          {reviewerCount > 0 && <Badge variant="outline">{reviewerCount} AI reviewers</Badge>}
        </h3>
        <Button size="xs" variant="outline" onClick={() => run.mutate()} disabled={run.isPending || pending !== null}>
          {checks.length ? "Ask the models again" : "Ask other models"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Blind vote. Each reviewer gets the same statistics and names the sensor on its own. No reviewer sees the primary name.</p>
      {run.isError && <p className="text-xs">{run.error.message}</p>}
      {checks.length > 0 && (
        <div role="group" aria-label="Verdict" className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 rounded-md border border-foreground px-3 py-2.5 text-sm">
          <span className="text-2xl font-semibold tabular-nums">
            {agree} / {checks.length}
          </span>
          <div className="flex flex-col gap-1">
            <span>
              gave the same name as the primary model{hypothesis ? "," : ""} {hypothesis && <span className="italic">{hypothesis}</span>}
            </span>
            <span className="flex gap-0.5" aria-hidden="true">
              {checks.map((c, i) => (
                <span key={c.model} className={cn("h-2 w-5 rounded-xs border border-foreground", i < agree ? "bg-foreground" : "border-dashed")} />
              ))}
            </span>
          </div>
          <p className="col-span-2 text-xs">
            <span className="font-medium">{verdict.word}</span>
            {verdict.sentence}
          </p>
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">The primary model proposed</span>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md bg-muted/50 px-3 py-2 text-sm">
          {primary && (
            <span className="inline-flex items-center gap-2 font-mono text-xs text-muted-foreground" title={primary.model}>
              <ModelLogo model={primary.model} className="size-5 text-foreground" />
              {shortModel(primary.model)}
            </span>
          )}
          <Hypothesis name={hypothesis} />
          {primary?.quantity && <span className="text-muted-foreground">({primary.quantity})</span>}
          {(primary?.confidence ?? hypothesisConfidence) !== null && (
            <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
              confidence <ConfidenceBar value={(primary?.confidence ?? hypothesisConfidence)!} />
            </span>
          )}
          {primary?.reason && (
            <p className="w-full text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Why:</span> {primary.reason}
            </p>
          )}
        </div>
      </div>
      {checks.length === 0 && waiting.length === 0 ? (
        <p className="text-xs text-muted-foreground">No vote yet. Press "Ask other models" to get an independent name from each reviewer.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">The reviewers answered</span>
          <ul className="grid gap-2 sm:grid-cols-2">
            {checks.map((c) => (
              <ReviewerCard key={c.model} check={c} runId={runId} />
            ))}
            {pending && waiting.map((m) => <WaitingCard key={m} model={m} job={pending} />)}
          </ul>
        </div>
      )}
    </section>
  );
}
