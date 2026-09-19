import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { CircleHelpIcon, CopyIcon } from "lucide-react";
import { toast } from "sonner";
import type { OpenQuestion } from "@tpm/schemas";
import { keys, listOpenQuestions } from "@/api";
import { ConfidenceBar } from "@/components/confidence-bar";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

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
  const groups = new Map<string | null, OpenQuestion[]>();
  for (const q of questions.data ?? []) groups.set(q.contact, [...(groups.get(q.contact) ?? []), q]);

  return (
    <>
      <PageHeader title="Open questions" description="Columns with a confidence under 0.5 and no confirmed claim. Send the list to the customer contact; each answer becomes a new source.">
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
              <Table aria-label={`Questions for ${contact ?? "no contact"}`}>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col" className="h-8">Column</TableHead>
                    <TableHead scope="col" className="h-8">Hypothesis</TableHead>
                    <TableHead scope="col" className="h-8">Confidence</TableHead>
                    <TableHead scope="col" className="h-8">Question</TableHead>
                    <TableHead scope="col" className="h-8 text-right">Unconfirmed claims</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.map((q) => (
                    <TableRow key={q.column.id}>
                      <TableCell className="py-1 font-mono">
                        <Link to={`/runs/${q.column.runId}/sensors#${q.column.alias}`} className="underline-offset-4 hover:underline">
                          {q.column.name}
                        </Link>
                        <span className="block text-xs text-muted-foreground">{q.column.alias}</span>
                      </TableCell>
                      <TableCell className="py-1">{q.column.hypothesis ?? <span className="text-muted-foreground">none</span>}</TableCell>
                      <TableCell className="py-1">
                        <ConfidenceBar value={q.column.confidence} />
                      </TableCell>
                      <TableCell className="py-1 whitespace-normal">{q.question}</TableCell>
                      <TableCell className="py-1 text-right font-mono tabular-nums">{q.hypothesisClaims}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
