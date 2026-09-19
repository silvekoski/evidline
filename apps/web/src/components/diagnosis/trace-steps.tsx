import { CheckIcon, CircleDashedIcon } from "lucide-react";
import { cn } from "cn";
import type { TraceStep } from "@tpm/schemas";
import { EvidenceChip } from "@/components/evidence-chip";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { formatNumber } from "@/lib/format";

const skipped = (step: TraceStep) => step.result.startsWith("Not run");

export function TraceSteps({ trace }: { trace: TraceStep[] }) {
  const notRun = trace.filter(skipped).length;
  return (
    <Accordion type="single" collapsible>
      <AccordionItem value="trace" className="border-b-0">
        <AccordionTrigger className="gap-3">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>Reasoning steps{notRun > 0 && <span className="font-normal text-muted-foreground">, {notRun} of {trace.length} not run</span>}</span>
            <span className="flex items-center gap-1" aria-hidden="true">
              {trace.map((step) => (
                <StepIcon key={step.index} step={step} />
              ))}
            </span>
          </span>
        </AccordionTrigger>
        <AccordionContent>
          <ol className="flex flex-col gap-3">
            {trace.map((step) => (
              <li key={step.index} className="grid grid-cols-[1rem_1fr] gap-x-2 border-l pl-3">
                <StepIcon step={step} className="mt-1" />
                <div className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-medium">{step.name}</span>
                    <span className="font-mono text-xs text-muted-foreground">n {step.n.toLocaleString("en-US")}</span>
                  </div>
                  <div className={cn(skipped(step) && "text-muted-foreground")}>{step.result}</div>
                  {Object.keys(step.stats).length > 0 && (
                    <dl className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-xs tabular-nums">
                      {Object.entries(step.stats).map(([key, value]) => (
                        <div key={key} className="flex gap-1">
                          <dt className="text-muted-foreground">{key}</dt>
                          <dd>{formatNumber(value)}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  <div className="flex flex-wrap gap-1">
                    {step.evidenceIds.map((id) => (
                      <EvidenceChip key={id} evidenceId={id} />
                    ))}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

function StepIcon({ step, className }: { step: TraceStep; className?: string }) {
  return skipped(step) ? (
    <CircleDashedIcon aria-hidden="true" className={cn("size-3.5 text-muted-foreground", className)} />
  ) : (
    <CheckIcon aria-hidden="true" className={cn("size-3.5", className)} />
  );
}
