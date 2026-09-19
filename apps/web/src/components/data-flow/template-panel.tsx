import { EqualIcon, EqualNotIcon } from "lucide-react";
import { Purpose, type TemplateInfo } from "@tpm/schemas";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { shortHash } from "@/lib/format";

export function HashMatch({ hash, runHash }: { hash: string; runHash: string | undefined }) {
  if (runHash === undefined) return <span className="text-xs text-muted-foreground">no run hash</span>;
  return hash === runHash ? (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <EqualIcon className="size-3.5" aria-hidden="true" />
      same as the run
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs">
      <EqualNotIcon className="size-3.5" aria-hidden="true" />
      differs from the run, {shortHash(runHash)}
    </span>
  );
}

export function TemplatePanel({ templates, runHashes }: { templates: TemplateInfo; runHashes: Partial<Record<Purpose, string>> | undefined }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Prompt templates</CardTitle>
        <CardDescription>Four constant templates with no dataset text. The panel compares each hash with the hash that the active run recorded.</CardDescription>
      </CardHeader>
      <CardContent>
        <Accordion type="multiple">
          {Purpose.options.map((purpose) => {
            const template = templates[purpose];
            return (
              <AccordionItem key={purpose} value={purpose}>
                <AccordionTrigger className="items-center">
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-mono">{purpose}</span>
                    <span className="font-mono text-xs text-muted-foreground">{shortHash(template.hash)}</span>
                    <HashMatch hash={template.hash} runHash={runHashes?.[purpose]} />
                  </span>
                </AccordionTrigger>
                <AccordionContent className="flex flex-col gap-2">
                  <div className="font-mono text-xs break-all text-muted-foreground">sha256 {template.hash}</div>
                  <pre className="max-h-72 overflow-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap">{template.text}</pre>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      </CardContent>
    </Card>
  );
}
