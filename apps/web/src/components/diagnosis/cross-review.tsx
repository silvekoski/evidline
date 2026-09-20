import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CpuIcon } from "lucide-react";
import { faultLabel, type DiagnosisInference, type Review, type ReviewMatch } from "@tpm/schemas";
import { getModelSettings, getReviews, keys, requestReview } from "@/api";
import { requestAction } from "@/hooks/use-action-request";
import { supportOf, VoteHeader, VoteRow, VoteTally, type VoteChip } from "@/components/model-vote";
import { Button } from "@/components/ui/button";

const chips: Record<ReviewMatch, VoteChip> = {
  class: { text: "Same class", variant: "default" },
  family: { text: "Same family", variant: "outline" },
  none: { text: "Other family", variant: "outline" },
};

function Reason({ review, incident }: { review: Review; incident: DiagnosisInference }) {
  const { verdict } = review;
  if (review.error !== null || verdict === null) return null;
  const errors = review.validator?.errors ?? [];
  if (review.validator?.pass !== true) {
    return (
      <>
        <p>
          Validator failed, {errors.length} {errors.length === 1 ? "error" : "errors"}. The text is hidden.
        </p>
        <ul className="list-disc pl-5">{errors.map((error, i) => <li key={i}>{error}</li>)}</ul>
      </>
    );
  }
  return (
    <>
      <p>{verdict.summary}</p>
      {verdict.concerns.length > 0 && <ul className="list-disc pl-5">{verdict.concerns.map((concern, i) => <li key={i}>{concern}</li>)}</ul>}
      <div className="flex flex-wrap gap-2">
        {verdict.concerns.length > 0 && (
          <Button variant="ghost" size="xs" onClick={() => requestAction({ inferenceId: incident.id, kind: "question", text: verdict.concerns.join(" ") })}>
            Ask about this
          </Button>
        )}
        {review.match !== "class" && (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => requestAction({ inferenceId: incident.id, kind: "override", value: { kind: "faultClass", faultClass: verdict.faultClass }, reason: `Reviewer ${review.model}: ${verdict.summary}` })}
          >
            Override to {faultLabel(verdict.faultClass)}
          </Button>
        )}
      </div>
    </>
  );
}

export function CrossReview({ incident }: { incident: DiagnosisInference }) {
  const queryClient = useQueryClient();
  const [why, setWhy] = useState(false);
  const settings = useQuery({ queryKey: keys.modelSettings, queryFn: getModelSettings });
  const report = useQuery({ queryKey: keys.reviews(incident.id), queryFn: () => getReviews(incident.id), refetchInterval: (query) => (query.state.data?.pending ? 3000 : false) });
  const ask = useMutation({ mutationFn: () => requestReview(incident.id), onSuccess: (data) => queryClient.setQueryData(keys.reviews(incident.id), data) });
  const mode = settings.data?.mode;
  const order = (settings.data?.reviewers ?? []).map((r) => r.model);
  const blocked =
    settings.data === undefined
      ? settings.isError
        ? "The model settings did not load."
        : null
      : mode === "off"
        ? "Model off."
        : mode === "local"
          ? "Reviewers need the cloud mode."
          : order.length === 0
            ? "No reviewer is set. Set TPM_REVIEW_KEY in the server environment."
            : null;
  const pending = report.data?.pending ?? null;
  const latest = new Map<string, Review>();
  for (const review of report.data?.reviews ?? []) if (!latest.has(review.model)) latest.set(review.model, review);
  const rank = (model: string) => (order.includes(model) ? order.indexOf(model) : order.length);
  const rows = [...latest.values()].sort((a, b) => rank(a.model) - rank(b.model));
  const waiting = pending ? order.filter((m) => !latest.has(m)) : [];
  const answered = rows.filter((r) => r.verdict !== null).length;
  const same = rows.filter((r) => r.match === "class").length;
  const chipOf = (r: Review): VoteChip => (r.match ? chips[r.match] : r.error === null ? { text: "Waiting", variant: "secondary" } : { text: "No answer", variant: "secondary" });
  const answerOf = (r: Review) =>
    r.verdict ? (
      <>
        {faultLabel(r.verdict.faultClass)}
        {r.inferenceId !== incident.id && <span className="text-muted-foreground"> (earlier version)</span>}
      </>
    ) : (
      <span className="text-muted-foreground">{r.error ?? "waiting for the answer"}</span>
    );

  return (
    <section aria-labelledby={`${incident.id}-review`} className="flex flex-col gap-2">
      <VoteHeader
        id={`${incident.id}-review`}
        question="Do other models agree with the fault class?"
        hint="Blind vote. Each reviewer gets the same numbers and trace steps and picks a fault class on its own. No reviewer sees the verdict of the engine."
        hasReason={rows.some((r) => r.verdict !== null)}
        why={why}
        onWhy={() => setWhy((v) => !v)}
        action={rows.length === 0 ? "Ask reviewers" : "Ask again"}
        disabled={blocked !== null || pending !== null || ask.isPending || settings.isPending}
        onAsk={() => ask.mutate()}
      />
      {(blocked ?? ask.error?.message) && <p className="text-xs text-muted-foreground">{blocked ?? ask.error?.message}</p>}
      {rows.length > 0 && <VoteTally agree={same} total={rows.length} sentence={`${same === 1 ? "reviewer picked" : "reviewers picked"} the same fault class. ${supportOf(same, answered)}`} />}
      <ul className="flex flex-col" aria-label="Fault class by model">
        <VoteRow
          model="engine"
          logo={<CpuIcon className="size-5 shrink-0 text-foreground" aria-hidden="true" />}
          answer={faultLabel(incident.value.faultClass)}
          confidence={incident.confidence}
          chip={{ text: "Engine", variant: "outline" }}
          runId={null}
          egressId={null}
          time={null}
          reason={null}
          why={why}
        />
        {rows.map((r) => (
          <VoteRow key={r.model} model={r.model} answer={answerOf(r)} confidence={r.verdict?.confidence ?? null} chip={chipOf(r)} runId={incident.runId} egressId={r.egressId} time={r.time} reason={<Reason review={r} incident={incident} />} why={why} />
        ))}
        {waiting.map((model) => (
          <VoteRow key={model} model={model} answer={<span className="text-muted-foreground">waiting for the answer</span>} confidence={null} chip={{ text: "Waiting", variant: "secondary" }} runId={null} egressId={null} time={null} reason={null} why={why} />
        ))}
        {rows.length === 0 && waiting.length === 0 && <li className="py-2 text-xs text-muted-foreground">No vote yet. Reviews run only when you ask.</li>}
      </ul>
    </section>
  );
}
