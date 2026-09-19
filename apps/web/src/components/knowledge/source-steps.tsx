import { CheckIcon, CircleDashedIcon, CircleXIcon, LoaderIcon } from "lucide-react";
import { cn } from "cn";
import type { Source } from "@tpm/schemas";

type State = "done" | "running" | "failed" | "todo";
type Step = { label: string; count: string | null; state: State };

const icons: Record<State, typeof CheckIcon> = { done: CheckIcon, running: LoaderIcon, failed: CircleXIcon, todo: CircleDashedIcon };

function steps(source: Source): Step[] {
  const busy = source.status === "received" || source.status === "processing";
  const textFailed = source.status === "failed" || source.status === "needs_ocr";
  const after = (count: number, total: number | null = null): State => (count > 0 && (total === null || count >= total) ? "done" : busy ? "running" : count > 0 ? "running" : "todo");
  return [
    { label: "Received", count: null, state: "done" },
    { label: "Text", count: source.segments ? `${source.segments} segments` : null, state: textFailed ? "failed" : source.segments > 0 ? "done" : busy ? "running" : "todo" },
    { label: "Chunks", count: source.chunks ? String(source.chunks) : null, state: textFailed ? "todo" : after(source.chunks) },
    { label: "Embedded", count: source.chunks ? `${source.embeddedChunks} of ${source.chunks}` : null, state: textFailed ? "todo" : after(source.embeddedChunks, source.chunks || null) },
    { label: "Claims", count: source.claims ? String(source.claims) : null, state: textFailed ? "todo" : source.claims > 0 ? "done" : source.embeddedChunks > 0 ? "todo" : after(0) },
  ];
}

export function SourceSteps({ source, className }: { source: Source; className?: string }) {
  return (
    <ol className={cn("flex flex-wrap gap-x-5 gap-y-1 text-xs", className)} aria-label="Processing steps">
      {steps(source).map((step) => {
        const Icon = icons[step.state];
        return (
          <li key={step.label} className={cn("flex items-center gap-1.5", step.state === "todo" && "text-muted-foreground")}>
            <Icon aria-hidden="true" className={cn("size-3.5", step.state === "running" && "motion-safe:animate-spin")} />
            <span>{step.label}</span>
            <span className="sr-only">, {step.state}</span>
            {step.count && <span className="font-mono text-muted-foreground">{step.count}</span>}
          </li>
        );
      })}
    </ol>
  );
}
