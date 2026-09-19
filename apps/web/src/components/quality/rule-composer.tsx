import { sentenceForms } from "@/lib/rule-forms";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { CheckIcon, CircleAlertIcon, PlayIcon, WandSparklesIcon } from "lucide-react";
import type { Rule } from "@tpm/schemas";
import { compileRule, keys } from "@/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useLens } from "@/hooks/use-lens";
import { RuleJsonBlock } from "./rule-table";
import { useActivateRule } from "./use-activate-rule";



export function RuleComposer({ runId }: { runId: string }) {
  const lens = useLens();
  const queryClient = useQueryClient();
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
    <Card>
      <CardHeader>
        <CardTitle>New rule</CardTitle>
        <CardDescription>
          Write the rule as one sentence. The compiler returns rule JSON, restates it, and counts past violations in the {lens.plant}. Nothing is active until you activate it.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
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
              <WandSparklesIcon aria-hidden="true" />
              Compile
            </Button>
          </div>
        </form>
        {compile.isError && (
          <Alert id="rule-error">
            <CircleAlertIcon aria-hidden="true" />
            <AlertTitle>{notUnderstood ? "Sentence not understood" : "Compile failed"}</AlertTitle>
            <AlertDescription>
              {notUnderstood ? (
                <>
                  <span>The compiler accepts these eight sentence forms.</span>
                  <ul className="mt-1 flex flex-col gap-0.5 font-mono text-xs">
                    {sentenceForms.map((form) => (
                      <li key={form}>{form}</li>
                    ))}
                  </ul>
                </>
              ) : (
                compile.error.message
              )}
            </AlertDescription>
          </Alert>
        )}
        {preview && (
          <section aria-labelledby="rule-preview-title" className="flex flex-col gap-2 rounded-lg border p-3">
            <h3 id="rule-preview-title" className="font-medium">
              Compiled rule <span className="ml-1 font-mono text-xs font-normal text-muted-foreground">{preview.rule.id}</span>
            </h3>
            <RuleJsonBlock rule={preview.rule} />
            <p>{preview.rule.restated}</p>
            <p className="text-muted-foreground">
              Past violations: <span className="font-mono tabular-nums text-foreground">{preview.rule.violations.toLocaleString("en-US")}</span>
            </p>
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
      </CardContent>
    </Card>
  );
}
