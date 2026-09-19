import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { EqualApproximatelyIcon, EqualIcon, EqualNotIcon, RefreshCwIcon } from "lucide-react";
import { faultLabel, type DiagnosisInference, type Review, type ReviewMatch } from "@tpm/schemas";
import { getModelSettings, getReviews, keys, requestReview } from "@/api";
import { requestAction } from "@/hooks/use-action-request";
import { screenPath } from "@/layout/screens";
import { ConfidenceBar } from "@/components/confidence-bar";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const matches: Record<ReviewMatch, { icon: typeof EqualIcon; word: string }> = {
  class: { icon: EqualIcon, word: "same class" },
  family: { icon: EqualApproximatelyIcon, word: "same family, names" },
  none: { icon: EqualNotIcon, word: "other family, names" },
};

export function CrossReview({ incident }: { incident: DiagnosisInference }) {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: keys.modelSettings, queryFn: getModelSettings });
  const report = useQuery({
    queryKey: keys.reviews(incident.id),
    queryFn: () => getReviews(incident.id),
    refetchInterval: (query) => (query.state.data?.pending ? 3000 : false),
  });
  const ask = useMutation({
    mutationFn: () => requestReview(incident.id),
    onSuccess: (data) => queryClient.setQueryData(keys.reviews(incident.id), data),
  });
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
  const answered = rows.filter((r) => r.verdict !== null);
  const same = answered.filter((r) => r.match === "class").length;
  const summary = pending
    ? `Review ${pending.index + 1} of ${pending.total} in progress, about 1 minute per model.`
    : rows.length === 0
      ? "No review yet. Reviews run only when you ask."
      : answered.length === 0
        ? "No reviewer answered."
        : `${same} of ${answered.length} ${answered.length === 1 ? "reviewer picks" : "reviewers pick"} the same fault class.`;

  return (
    <section aria-labelledby={`${incident.id}-review`} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h3 id={`${incident.id}-review`} className="text-sm font-medium">
            Cross review
          </h3>
          <p className="text-xs text-muted-foreground">Each verdict is a hypothesis from a second model. The engine decides the fault class.</p>
        </div>
        <Button size="sm" variant="outline" disabled={blocked !== null || pending !== null || ask.isPending || settings.isPending} onClick={() => ask.mutate()}>
          <RefreshCwIcon aria-hidden="true" />
          {rows.length === 0 ? "Ask reviewers" : "Ask again"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {blocked ?? summary}
      </p>
      {rows.length > 0 && (
        <ul className="flex flex-col gap-3">
          {rows.map((review) => (
            <ReviewRow key={review.model} review={review} incident={incident} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ReviewRow({ review, incident }: { review: Review; incident: DiagnosisInference }) {
  const { verdict, match } = review;
  const label = verdict ? faultLabel(verdict.faultClass) : "";
  const withheld = review.validator?.pass !== true;
  const errors = review.validator?.errors.length ?? 0;
  const Match = match ? matches[match].icon : null;
  return (
    <li className="flex flex-col gap-1 border-l pl-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs">{review.model}</span>
        <StatusBadge kind="hypothesis" />
        {verdict && match && Match && (
          <Badge variant="outline" className="font-normal">
            <Match aria-hidden="true" />
            {match === "class" ? matches[match].word : `${matches[match].word} ${label}`}
          </Badge>
        )}
        {verdict && <ConfidenceBar value={verdict.confidence} />}
        <Link to={screenPath(incident.runId, "data-flow", review.egressId)} className="font-mono text-xs text-muted-foreground underline-offset-4 hover:underline">
          {review.egressId}
        </Link>
        {review.inferenceId !== incident.id && <span className="text-xs text-muted-foreground">on an earlier version</span>}
      </div>
      {review.error !== null ? (
        <p className="text-muted-foreground">{review.error}</p>
      ) : verdict === null ? (
        <p className="text-muted-foreground">Waiting for the answer.</p>
      ) : withheld ? (
        <div className="flex flex-col gap-1 text-xs text-muted-foreground">
          <p>
            Validator failed, {errors} {errors === 1 ? "error" : "errors"}. The text is hidden.
          </p>
          <ul className="list-disc pl-5">{review.validator?.errors.map((error, i) => <li key={i}>{error}</li>)}</ul>
        </div>
      ) : (
        <>
          <p className="italic">{verdict.summary}</p>
          {verdict.concerns.length > 0 && <ul className="list-disc pl-5 text-muted-foreground">{verdict.concerns.map((concern, i) => <li key={i}>{concern}</li>)}</ul>}
          <div className="flex flex-wrap gap-2">
            {verdict.concerns.length > 0 && (
              <Button variant="ghost" size="xs" onClick={() => requestAction({ inferenceId: incident.id, kind: "question", text: verdict.concerns.join(" ") })}>
                Ask about this
              </Button>
            )}
            {match !== "class" && (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => requestAction({ inferenceId: incident.id, kind: "override", value: { kind: "faultClass", faultClass: verdict.faultClass }, reason: `Reviewer ${review.model}: ${verdict.summary}` })}
              >
                Override to {label}
              </Button>
            )}
          </div>
        </>
      )}
    </li>
  );
}
