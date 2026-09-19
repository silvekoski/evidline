import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, MinusIcon, SparklesIcon, XIcon } from "lucide-react";
import { cn } from "cn";
import type { SensorRow } from "@tpm/schemas";
import { getNameChecks, keys, requestNameCheck } from "@/api";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatTime } from "@/lib/format";
import { useOpenSensor } from "./use-open-sensor";

export const shortModel = (model: string): string => model.split("/").pop()?.replace(/-Instruct.*$/i, "") ?? model;

export function NameCheckMarks({ checks, roleInferenceId }: { checks: SensorRow["nameChecks"]; roleInferenceId: string }) {
  const open = useOpenSensor();
  if (checks.length === 0) return null;
  const agree = checks.filter((c) => c.agrees === true).length;
  const label = `${agree} of ${checks.length} models agree: ${checks.map((c) => `${shortModel(c.model)} ${c.agrees === true ? "agrees" : c.agrees === false ? "differs" : "no answer"}${c.name ? ` (${c.name})` : ""}`).join(", ")}. Open to see the full cross-check.`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-0.5 rounded-sm font-mono text-xs text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          aria-label={label}
          onClick={(event) => {
            event.stopPropagation();
            open(roleInferenceId);
          }}
        >
          {checks.map((c) => (
            <span key={c.model} aria-hidden="true" className={cn("inline-flex size-4 items-center justify-center rounded-sm border", c.agrees === true && "border-foreground text-foreground", c.agrees === false && "border-dashed")}>
              {c.agrees === true ? <CheckIcon className="size-3" /> : c.agrees === false ? <XIcon className="size-3" /> : <MinusIcon className="size-3" />}
            </span>
          ))}
          <span className="ml-1">
            {agree}/{checks.length}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{label}</TooltipContent>
    </Tooltip>
  );
}

export function NameCheckPanel({ inferenceId, hypothesis }: { inferenceId: string; hypothesis: string | null }) {
  const queryClient = useQueryClient();
  const report = useQuery({ queryKey: keys.nameChecks(inferenceId), queryFn: () => getNameChecks(inferenceId), refetchInterval: (q) => (q.state.data?.pending ? 2000 : false) });
  const run = useMutation({ mutationFn: () => requestNameCheck(inferenceId), onSuccess: () => void queryClient.invalidateQueries() });
  const checks = report.data?.checks ?? [];
  return (
    <section aria-labelledby={`checks-${inferenceId}`} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`checks-${inferenceId}`} className="text-sm font-medium">
          Cross-check of the hypothesis
        </h3>
        <Button size="xs" variant="outline" onClick={() => run.mutate()} disabled={run.isPending || report.data?.pending !== null}>
          <SparklesIcon aria-hidden="true" /> {checks.length ? "Ask the models again" : "Ask other models"}
        </Button>
      </div>
      {run.isError && <p className="text-xs">{run.error.message}</p>}
      {report.data?.pending && (
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {report.data.pending.done} of {report.data.pending.total} calls done, now {shortModel(report.data.pending.model)}.
        </p>
      )}
      {checks.length === 0 ? (
        <p className="text-xs text-muted-foreground">No cross-check yet. Each reviewer model gets the same statistics and never sees the name {hypothesis ? `"${hypothesis}"` : "of the primary model"}.</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {checks.map((c) => (
            <li key={c.model} className="flex flex-wrap items-baseline gap-2">
              <span className={cn("inline-flex size-4 items-center justify-center rounded-sm border", c.agrees === true && "border-foreground")} aria-label={c.agrees === true ? "agrees" : c.agrees === false ? "differs" : "no answer"}>
                {c.agrees === true ? <CheckIcon className="size-3" aria-hidden="true" /> : c.agrees === false ? <XIcon className="size-3" aria-hidden="true" /> : <MinusIcon className="size-3" aria-hidden="true" />}
              </span>
              <span className="font-mono text-xs">{c.model}</span>
              {c.name ? (
                <span>
                  {c.name}
                  {c.quantity ? <span className="text-muted-foreground"> ({c.quantity})</span> : null}
                  {c.confidence !== null && <span className="font-mono text-xs text-muted-foreground"> {c.confidence.toFixed(2)}</span>}
                </span>
              ) : (
                <span className="text-muted-foreground">{c.error ?? "no answer"}</span>
              )}
              <span className="text-xs text-muted-foreground">{formatTime(c.time)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
