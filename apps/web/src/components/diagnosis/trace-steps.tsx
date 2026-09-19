import type { TraceStep } from "@tpm/schemas";
import { EvidenceChip } from "@/components/evidence-chip";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { formatNumber } from "@/lib/format";

export function TraceSteps({ trace }: { trace: TraceStep[] }) {
  return (
    <Accordion type="single" collapsible>
      <AccordionItem value="trace" className="border-b-0">
        <AccordionTrigger>Reasoning steps ({trace.length})</AccordionTrigger>
        <AccordionContent>
          <ol className="flex flex-col gap-3">
            {trace.map((step, i) => (
              <li key={step.index} className="grid grid-cols-[1.5rem_1fr] gap-x-2 border-l pl-3">
                <span className="font-mono text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                <div className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{step.name}</span>
                    <Badge variant="outline" className="font-normal">
                      {step.test}
                    </Badge>
                    <span className="font-mono text-xs text-muted-foreground">n {step.n.toLocaleString("en-US")}</span>
                  </div>
                  <div>{step.result}</div>
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
