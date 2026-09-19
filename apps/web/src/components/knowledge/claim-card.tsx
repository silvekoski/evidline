import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { CheckIcon, ExternalLinkIcon, XIcon } from "lucide-react";
import type { Claim, ClaimLink } from "@tpm/schemas";
import { setClaimStatus, setLinkConfirmed } from "@/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatTime } from "@/lib/format";
import { ClaimStatusBadge, ProvenanceBadge, SourceKindBadge } from "./badges";
import { locatorLabel, sourceHref } from "./locator";

function LinkRow({ link, onChange }: { link: ClaimLink; onChange: () => void }) {
  const confirm = useMutation({ mutationFn: (confirmed: boolean) => setLinkConfirmed(link.id, confirmed), onSuccess: onChange });
  return (
    <li className="flex flex-wrap items-center gap-2 text-sm">
      <span className="font-mono">{link.column}</span>
      <span className="font-mono text-xs text-muted-foreground">{link.score.toFixed(2)}</span>
      {link.confirmed === true && <Badge variant="outline">confirmed</Badge>}
      {link.confirmed === false && <Badge variant="ghost" className="text-muted-foreground line-through">rejected</Badge>}
      {link.confirmed !== true && (
        <Button size="xs" variant="outline" aria-label={`Confirm the link to ${link.column}`} onClick={() => confirm.mutate(true)} disabled={confirm.isPending}>
          <CheckIcon aria-hidden="true" /> Confirm
        </Button>
      )}
      {link.confirmed !== false && (
        <Button size="xs" variant="ghost" aria-label={`Reject the link to ${link.column}`} onClick={() => confirm.mutate(false)} disabled={confirm.isPending}>
          <XIcon aria-hidden="true" /> Reject
        </Button>
      )}
    </li>
  );
}

export function ClaimCard({ claim, showSource = true }: { claim: Claim; showSource?: boolean }) {
  const queryClient = useQueryClient();
  const refresh = () => void queryClient.invalidateQueries();
  const status = useMutation({ mutationFn: (value: Claim["status"]) => setClaimStatus(claim.id, value), onSuccess: refresh });
  return (
    <article className="flex flex-col gap-2 rounded-lg border p-3" aria-labelledby={`claim-${claim.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <ProvenanceBadge value={claim.provenance} />
        <ClaimStatusBadge value={claim.status} />
        <span className="font-mono text-xs text-muted-foreground">claim {claim.id}</span>
        {claim.occurredAt && <span className="text-xs text-muted-foreground">{formatTime(claim.occurredAt)}</span>}
        {claim.speaker && <span className="text-xs text-muted-foreground">{claim.speaker}</span>}
      </div>
      <p id={`claim-${claim.id}`} className="text-sm">
        {claim.statement}
      </p>
      <blockquote className="border-l-2 pl-3 text-sm text-muted-foreground">“{claim.quote}”</blockquote>
      {claim.note && <p className="text-xs text-muted-foreground">{claim.note}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {showSource && <SourceKindBadge value={claim.sourceKind} />}
        <Button asChild size="xs" variant="outline">
          <Link to={sourceHref(claim.sourceId, claim.locator, claim.quote)}>
            <ExternalLinkIcon aria-hidden="true" /> Open source
          </Link>
        </Button>
        <span className="text-xs text-muted-foreground">
          {claim.sourceTitle}, {locatorLabel(claim.locator)}
        </span>
        <span className="ml-auto flex gap-1">
          {claim.status !== "confirmed" && (
            <Button size="xs" variant="outline" onClick={() => status.mutate("confirmed")} disabled={status.isPending}>
              <CheckIcon aria-hidden="true" /> Confirm claim
            </Button>
          )}
          {claim.status !== "contradicted" && (
            <Button size="xs" variant="ghost" onClick={() => status.mutate("contradicted")} disabled={status.isPending}>
              <XIcon aria-hidden="true" /> Contradict
            </Button>
          )}
        </span>
      </div>
      {claim.links.length > 0 ? (
        <ul className="flex flex-col gap-1" aria-label="Column links">
          {claim.links.map((link) => (
            <LinkRow key={link.id} link={link} onChange={refresh} />
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">No column link. The claim is unlinked.</p>
      )}
    </article>
  );
}
