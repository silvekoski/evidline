import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { CircleHelpIcon, CopyIcon, MessageSquareReplyIcon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import type { OpenQuestion } from "@tpm/schemas";
import { keys, listOpenQuestions } from "@/api";
import { ConfidenceBar } from "@/components/confidence-bar";
import { EmptyState } from "@/components/empty-state";
import { AnswerForm } from "@/components/knowledge/answer-form";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

const emailText = (contact: string | null, questions: OpenQuestion[]): string =>
  [
    `Hello${contact ? ` ${contact.split(" ")[0]}` : ""},`,
    "",
    "We have a few open questions about the data columns. Short answers are enough, a voice note also works.",
    "",
    ...questions.map((q, i) => `${i + 1}. ${q.question}`),
    "",
    "Thank you.",
  ].join("\n");

async function copy(text: string, label: string): Promise<void> {
  await navigator.clipboard.writeText(text);
  toast.success(`${label} copied`);
}

export function OpenQuestionsScreen() {
  const questions = useQuery({ queryKey: keys.openQuestions, queryFn: listOpenQuestions, refetchInterval: 10000 });
  const [open, setOpen] = useState<number | null>(null);
  const groups = new Map<string | null, OpenQuestion[]>();
  for (const q of questions.data ?? []) groups.set(q.contact, [...(groups.get(q.contact) ?? []), q]);

  return (
    <>
      <PageHeader title="Open questions" description="Columns with a confidence under 0.5 and no confirmed claim. Type an answer you got, or send the list to the customer contact. Each answer becomes a source.">
        {questions.data && questions.data.length > 0 && (
          <Button size="sm" onClick={() => copy(emailText(null, questions.data), "Email text")}>
            <CopyIcon aria-hidden="true" /> Copy all as email
          </Button>
        )}
      </PageHeader>
      {questions.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : questions.isError ? (
        <EmptyState title="Questions not available" description={questions.error.message} />
      ) : questions.data.length === 0 ? (
        <EmptyState icon={CircleHelpIcon} title="No open question" description="Every low-confidence column has a confirmed claim, or the catalog is empty. Run a sensor file to build the catalog." />
      ) : (
        <div className="flex flex-col gap-6">
          {[...groups.entries()].map(([contact, list]) => (
            <section key={contact ?? "none"} aria-labelledby={`contact-${contact ?? "none"}`} className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <h2 id={`contact-${contact ?? "none"}`} className="text-sm font-medium">
                  {contact ?? "No contact yet"} <span className="text-muted-foreground">({list.length})</span>
                </h2>
                <Button size="xs" variant="outline" onClick={() => copy(emailText(contact, list), "Email text")}>
                  <CopyIcon aria-hidden="true" /> Copy as email
                </Button>
              </div>
              <ol className="flex flex-col gap-1" aria-label={`Questions for ${contact ?? "no contact"}`}>
                {list.map((q) => {
                  const isOpen = open === q.column.id;
                  return (
                    <li key={q.column.id} className={cn("rounded-md border", isOpen && "border-foreground")}>
                      <div className="grid items-center gap-x-4 gap-y-1 p-2 text-sm sm:grid-cols-[10rem_minmax(0,1fr)_8rem_7rem_auto]">
                        <div className="font-mono">
                          <Link to={`/runs/${q.column.runId}/sensors#${q.column.alias}`} className="underline-offset-4 hover:underline">
                            {q.column.name}
                          </Link>
                          <span className="block text-xs text-muted-foreground">{q.column.alias}</span>
                        </div>
                        <div>
                          <span className="block">{q.column.hypothesis ?? <span className="text-muted-foreground">No hypothesis</span>}</span>
                          <span className="block text-xs text-muted-foreground">Unit and logging interval unknown</span>
                        </div>
                        <ConfidenceBar value={q.column.confidence} />
                        <span className="font-mono text-xs tabular-nums text-muted-foreground">{q.hypothesisClaims} unconfirmed</span>
                        <Button size="sm" variant={isOpen ? "default" : "outline"} aria-expanded={isOpen} aria-controls={`answer-${q.column.id}`} onClick={() => setOpen(isOpen ? null : q.column.id)}>
                          <MessageSquareReplyIcon aria-hidden="true" /> Answer
                        </Button>
                      </div>
                      {isOpen && (
                        <div id={`answer-${q.column.id}`} className="border-t p-2">
                          <AnswerForm question={q} onDone={() => setOpen(null)} />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
