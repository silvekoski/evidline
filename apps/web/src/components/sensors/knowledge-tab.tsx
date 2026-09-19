import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { getColumnKnowledge, keys } from "@/api";
import { ConfidenceBar } from "@/components/confidence-bar";
import { ClaimCard } from "@/components/knowledge/claim-card";
import { LOW_CONFIDENCE } from "@/components/sensors/knowledge-cell";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

export function KnowledgeTab({ sourceName }: { sourceName: string }) {
  const knowledge = useQuery({ queryKey: keys.columnKnowledge(sourceName), queryFn: () => getColumnKnowledge(sourceName), retry: false });
  if (knowledge.isPending) return <Skeleton className="h-40 w-full" />;
  if (knowledge.isError)
    return (
      <p className="text-muted-foreground">
        No catalog entry for <span className="font-mono">{sourceName}</span> yet. The catalog fills after the run finishes.
      </p>
    );
  const { column, claims, aliases } = knowledge.data;
  const confirmed = claims.filter((c) => c.status === "confirmed");
  const review = claims.filter((c) => c.status !== "confirmed");
  const open = column.confidence < LOW_CONFIDENCE && column.confirmedClaims === 0;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {confirmed.length > 0 ? (
          <span className="italic text-muted-foreground">Model hypothesis: {column.hypothesis ?? "none"}, replaced by the confirmed claims below</span>
        ) : (
          <>
            <span>Hypothesis: {column.hypothesis ?? <span className="text-muted-foreground">none</span>}</span>
            <ConfidenceBar value={column.confidence} />
          </>
        )}
        <span className="text-muted-foreground">
          {column.claims} claims, {column.confirmedClaims} confirmed
        </span>
        {open && (
          <Link to={`/open-questions#q-${column.id}`} className="underline-offset-4 hover:underline">
            Open question for the customer
          </Link>
        )}
      </div>
      {aliases.length > 0 && (
        <p className="flex flex-wrap items-center gap-1 text-sm">
          <span className="text-muted-foreground">Customer words:</span>
          {aliases.map((a) => (
            <Badge key={a} variant="outline">
              {a}
            </Badge>
          ))}
        </p>
      )}
      {claims.length === 0 && <p className="text-muted-foreground">No claim links to this column yet. Upload a call transcript, an email, or a document that mentions it.</p>}
      {confirmed.length > 0 && (
        <section aria-labelledby={`known-${column.id}`} className="flex flex-col gap-2">
          <h3 id={`known-${column.id}`} className="text-sm font-medium">
            What we know <span className="font-normal text-muted-foreground">({confirmed.length} confirmed)</span>
          </h3>
          {confirmed.map((claim) => (
            <ClaimCard key={claim.id} claim={claim} />
          ))}
        </section>
      )}
      {review.length > 0 && (
        <section aria-labelledby={`review-${column.id}`} className="flex flex-col gap-2">
          <h3 id={`review-${column.id}`} className="text-sm font-medium">
            To review <span className="font-normal text-muted-foreground">({review.length})</span>
          </h3>
          {review.map((claim) => (
            <ClaimCard key={claim.id} claim={claim} />
          ))}
        </section>
      )}
    </div>
  );
}
