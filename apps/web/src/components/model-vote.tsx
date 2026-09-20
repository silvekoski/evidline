import type { ReactNode } from "react";
import { Link } from "react-router";
import { FileJsonIcon } from "lucide-react";
import { cn } from "cn";
import { ConfidenceBar } from "@/components/confidence-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ModelLogo } from "@/components/sensors/model-logo";
import { formatTime } from "@/lib/format";

export const shortModel = (model: string): string => model.split("/").pop()?.replace(/-Instruct.*$/i, "") ?? model;

export type VoteChip = { text: string; variant: "default" | "outline" | "secondary" };

export function supportOf(agree: number, answered: number): string {
  const share = answered === 0 ? 0 : agree / answered;
  return share >= 0.75 ? "Strong support." : share >= 0.5 ? "Mixed support." : share > 0 ? "Weak support." : "No support.";
}

export function VoteHeader({
  id,
  question,
  hint,
  hasReason,
  why,
  onWhy,
  action,
  disabled,
  onAsk,
}: {
  id: string;
  question: string;
  hint: string;
  hasReason: boolean;
  why: boolean;
  onWhy: () => void;
  action: string;
  disabled: boolean;
  onAsk: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 id={id} className="text-sm font-medium">
        {question}
      </h3>
      <span className="inline-flex items-center gap-1">
        {hasReason && (
          <Button size="xs" variant="ghost" aria-pressed={why} onClick={onWhy}>
            {why ? "Hide reasons" : "Show reasons"}
          </Button>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="xs" variant="outline" disabled={disabled} onClick={onAsk}>
              {action}
            </Button>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">{hint}</TooltipContent>
        </Tooltip>
      </span>
    </div>
  );
}

export function VoteTally({ agree, total, sentence }: { agree: number; total: number; sentence: string }) {
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <span className="font-semibold tabular-nums">
        {agree} / {total}
      </span>
      <span className="flex gap-0.5" aria-hidden="true">
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className={cn("h-2 w-5 rounded-xs border border-foreground", i < agree ? "bg-foreground" : "border-dashed")} />
        ))}
      </span>
      <span className="text-muted-foreground">{sentence}</span>
    </p>
  );
}

export function VoteRow({
  model,
  logo,
  answer,
  confidence,
  chip,
  runId,
  egressId,
  time,
  reason,
  why,
}: {
  model: string;
  logo?: ReactNode;
  answer: ReactNode;
  confidence: number | null;
  chip: VoteChip;
  runId: string | null;
  egressId: string | null;
  time: string | null;
  reason: ReactNode;
  why: boolean;
}) {
  return (
    <li className="grid grid-cols-[auto_minmax(8rem,1fr)_auto_auto] items-center gap-x-3 gap-y-1 border-b py-2 text-sm last:border-b-0">
      <span className="inline-flex w-44 items-center gap-2 truncate font-mono text-xs text-muted-foreground" title={model}>
        {logo ?? <ModelLogo model={model} className="size-5 text-foreground" />}
        <span className="truncate">{shortModel(model)}</span>
      </span>
      <span className="min-w-0">{answer}</span>
      <span className="w-20">{confidence !== null && <ConfidenceBar value={confidence} />}</span>
      <span className="inline-flex items-center gap-1">
        <Badge variant={chip.variant} className="w-24 justify-center">
          {chip.text}
        </Badge>
        {runId && egressId ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                to={{ pathname: `/runs/${runId}/data-flow`, hash: `#${egressId}` }}
                className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                aria-label="What the model saw and said"
              >
                <FileJsonIcon className="size-3.5" aria-hidden="true" />
              </Link>
            </TooltipTrigger>
            <TooltipContent>What the model saw and said{time ? `, ${formatTime(time)}` : ""}</TooltipContent>
          </Tooltip>
        ) : (
          <span className="size-6" aria-hidden="true" />
        )}
      </span>
      {why && reason && <div className="col-span-full flex flex-col gap-1 text-xs text-muted-foreground">{reason}</div>}
    </li>
  );
}
