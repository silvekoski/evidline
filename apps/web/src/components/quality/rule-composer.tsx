import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { CheckIcon, CircleAlertIcon, PlayIcon, PlusIcon } from "lucide-react";
import type { Rule } from "@tpm/schemas";
import { compileRule, keys } from "@/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useLens } from "@/hooks/use-lens";
import { sentenceForms } from "@/lib/rule-forms";
import { RuleJsonBlock } from "./rule-table";
import { useActivateRule } from "./use-activate-rule";
import { percent } from "./signal-lane";

export function RuleComposer({ runId, gridSize }: { runId: string; gridSize: number }) {
  const lens = useLens();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [sentence, setSentence] = useState("");
  const [preview, setPreview] = useState<{ rule: Rule; egressId: string | null } | null>(null);
  const compile = useMutation({
    mutationFn: (text: string) => compileRule(runId, text),
    onSuccess: (result) => {
      setPreview(result);
      void queryClient.invalidateQueries({ queryKey: keys.quality(runId) });
    },
  });
  const activate = useActivateRule((rule) => setPreview((p) => (p ? { ...p, rule } : p)));
  const notUnderstood = compile.isError && /not understood/i.test(compile.error.message);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button size="sm">
          <PlusIcon aria-hidden="true" />
          New rule
        </Button>
      </SheetTrigger>
      <SheetContent className="overflow-y-auto data-[side=right]:sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>New rule</SheetTitle>
          <SheetDescription>Write the rule as one sentence. The compiler restates it and counts past violations in the {lens.plant}. Nothing is active until you activate it.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4 pb-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">Eight sentence forms. Click one to start from it.</span>
            <div className="flex flex-wrap gap-1" role="list" aria-label="Sentence forms">
              {sentenceForms.map((form) => (
                <Badge key={form} asChild variant="outline" className="cursor-pointer font-mono font-normal hover:bg-muted">
                  <button type="button" role="listitem" onClick={() => setSentence(form)}>
                    {form}
                  </button>
                </Badge>
              ))}
            </div>
          </div>
          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              compile.mutate(sentence.trim());
            }}
          >
            <Label htmlFor="rule-sentence">Sentence</Label>
            <Textarea
              id="rule-sentence"
              value={sentence}
              onChange={(e) => setSentence(e.target.value)}
              maxLength={500}
              required
              placeholder={sentenceForms[0]}
              aria-invalid={compile.isError || undefined}
              aria-describedby={compile.isError ? "rule-error" : undefined}
            />
            <div>
              <Button type="submit" disabled={compile.isPending || sentence.trim().length === 0}>
                Compile
              </Button>
            </div>
          </form>
          {compile.isError && (
            <Alert id="rule-error">
              <CircleAlertIcon aria-hidden="true" />
              <AlertTitle>{notUnderstood ? "Sentence not understood" : "Compile failed"}</AlertTitle>
              <AlertDescription>{notUnderstood ? "Start from one of the eight sentence forms above." : compile.error.message}</AlertDescription>
            </Alert>
          )}
          {preview && (
            <section aria-labelledby="rule-preview-title" className="flex flex-col gap-2 rounded-lg border p-3">
              <h3 id="rule-preview-title" className="font-medium">
                Compiled rule <span className="ml-1 font-mono text-xs font-normal text-muted-foreground">{preview.rule.id}</span>
              </h3>
              <p>{preview.rule.restated}</p>
              <p className="text-muted-foreground">
                Past violations: <span className="font-mono tabular-nums text-foreground">{preview.rule.violations.toLocaleString("en-US")}</span> ({percent(gridSize === 0 ? 0 : preview.rule.violations / gridSize)} of the run)
              </p>
              <details>
                <summary className="cursor-pointer text-sm text-muted-foreground">Rule JSON</summary>
                <RuleJsonBlock rule={preview.rule} />
              </details>
              {preview.egressId && (
                <p className="text-xs text-muted-foreground">
                  Model call{" "}
                  <Link to={{ pathname: `/runs/${runId}/data-flow`, hash: `#${preview.egressId}` }} className="font-mono underline-offset-4 hover:underline">
                    {preview.egressId}
                  </Link>
                </p>
              )}
              <div>
                {preview.rule.active ? (
                  <span className="inline-flex items-center gap-1 text-sm">
                    <CheckIcon className="size-3.5" aria-hidden="true" />
                    Active
                  </span>
                ) : (
                  <Button onClick={() => activate.mutate(preview.rule.id)} disabled={activate.isPending}>
                    <PlayIcon aria-hidden="true" />
                    Activate
                  </Button>
                )}
              </div>
            </section>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
