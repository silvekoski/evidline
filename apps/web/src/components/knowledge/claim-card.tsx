import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { CheckIcon, ExternalLinkIcon, XIcon } from "lucide-react";
import { cn } from "cn";
import type { Claim, ClaimLink } from "@tpm/schemas";
import { setClaimStatus, setLinkConfirmed } from "@/api";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatTime } from "@/lib/format";
import { ClaimStatusBadge, ProvenanceBadge, SourceKindBadge } from "./badges";
import { locatorLabel, sourceHref } from "./locator";

function LinkChip({ link, onChange }: { link: ClaimLink; onChange: () => void }) {
  const confirm = useMutation({ mutationFn: (confirmed: boolean) => setLinkConfirmed(link.id, confirmed), onSuccess: onChange });
  const state = link.confirmed === true ? "confirmed" : link.confirmed === false ? "rejected" : "candidate";
  return (
    <li className={cn("inline-flex h-6 items-center gap-1 rounded-md border pl-2 text-xs", state === "confirmed" && "border-foreground", state === "rejected" && "border-dashed text-muted-foreground")}>
      {state === "confirmed" && <CheckIcon aria-hidden="true" className="size-3" />}
      <span className={cn("font-mono", state === "rejected" && "line-through")}>{link.column}</span>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="font-mono text-muted-foreground" aria-label={`Match score for the link to ${link.column}: ${link.score.toFixed(2)}`}>
            {link.score.toFixed(2)}
          </span>
        </TooltipTrigger>
        <TooltipContent>Match score between this claim and {link.column}, not a sensor value</TooltipContent>
      </Tooltip>
      <span className="sr-only">, {state}</span>
      {state === "candidate" && (
        <Button size="icon-xs" variant="ghost" aria-label={`Confirm the link to ${link.column}`} onClick={() => confirm.mutate(true)} disabled={confirm.isPending}>
          <CheckIcon aria-hidden="true" />
        </Button>
      )}
      {state !== "rejected" && (
        <Button size="icon-xs" variant="ghost" aria-label={`Reject the link to ${link.column}`} onClick={() => confirm.mutate(false)} disabled={confirm.isPending}>
          <XIcon aria-hidden="true" />
        </Button>
      )}
      {state === "rejected" && <span className="w-1" />}
    </li>
  );
}

export function ClaimCard({ claim, showSource = true }: { claim: Claim; showSource?: boolean }) {
  const queryClient = useQueryClient();
  const refresh = () => void queryClient.invalidateQueries();
  const status = useMutation({ mutationFn: (value: Claim["status"]) => setClaimStatus(claim.id, value), onSuccess: refresh });
  const top = claim.links.find((l) => l.confirmed !== false) ?? null;
  const confirmFor = useMutation({
    mutationFn: async () => {
      if (top && top.confirmed !== true) await setLinkConfirmed(top.id, true);
      await setClaimStatus(claim.id, "confirmed");
    },
    onSuccess: refresh,
  });
  const busy = status.isPending || confirmFor.isPending;
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
      {claim.links.length > 0 ? (
        <ul className="flex flex-wrap gap-1" aria-label="Column links">
          {claim.links.map((link) => (
            <LinkChip key={link.id} link={link} onChange={refresh} />
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">No column link. The claim is unlinked.</p>
      )}
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
          {claim.status !== "confirmed" && top && (
            <Button size="xs" onClick={() => confirmFor.mutate()} disabled={busy}>
              <CheckIcon aria-hidden="true" /> Confirm for {top.column}
            </Button>
          )}
          {claim.status !== "confirmed" && !top && (
            <Button size="xs" variant="outline" onClick={() => status.mutate("confirmed")} disabled={busy}>
              <CheckIcon aria-hidden="true" /> Confirm claim
            </Button>
          )}
          {claim.status !== "contradicted" && (
            <Button size="xs" variant="ghost" onClick={() => status.mutate("contradicted")} disabled={busy}>
              <XIcon aria-hidden="true" /> Contradict
            </Button>
          )}
        </span>
      </div>
    </article>
  );
}
