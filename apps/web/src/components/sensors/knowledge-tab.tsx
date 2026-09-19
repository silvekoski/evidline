import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { getColumnKnowledge, keys } from "@/api";
import { ConfidenceBar } from "@/components/confidence-bar";
import { ClaimCard } from "@/components/knowledge/claim-card";
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
  const open = column.confidence < 0.5 && column.confirmedClaims === 0;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>Hypothesis: {column.hypothesis ?? <span className="text-muted-foreground">none</span>}</span>
        <ConfidenceBar value={column.confidence} />
        <span className="text-muted-foreground">
          {column.claims} claims, {column.confirmedClaims} confirmed
        </span>
        {open && (
          <Link to="/open-questions" className="underline-offset-4 hover:underline">
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
      {claims.length === 0 ? (
        <p className="text-muted-foreground">No claim links to this column yet. Upload a call transcript, an email, or a document that mentions it.</p>
      ) : (
        claims.map((claim) => <ClaimCard key={claim.id} claim={claim} />)
      )}
    </div>
  );
}
