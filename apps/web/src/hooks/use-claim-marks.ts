import { useQuery } from "@tanstack/react-query";
import { keys, listClaims } from "@/api";
import { useRun } from "./use-run";

export type ClaimMark = { at: number; label: string; claimId: number };

export function useClaimMarks(runId: string): ClaimMark[] {
  const run = useRun(runId);
  const claims = useQuery({ queryKey: keys.claims, queryFn: listClaims, staleTime: 30_000 });
  const { t0, dt, n } = run.data?.timeBase ?? { t0: null, dt: null, n: 0 };
  if (t0 === null || dt === null || !claims.data) return [];
  return claims.data.flatMap((claim) => {
    if (!claim.occurredAt || claim.status === "contradicted") return [];
    const at = Math.round((Date.parse(claim.occurredAt) - t0) / dt);
    if (!Number.isFinite(at) || at < 0 || at >= n) return [];
    const day = claim.occurredAt.slice(0, 10);
    return [{ at, label: `${claim.statement.slice(0, 32)}${claim.statement.length > 32 ? "…" : ""}, ${day}`, claimId: claim.id }];
  });
}
