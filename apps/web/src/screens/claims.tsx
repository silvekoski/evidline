import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ListChecksIcon } from "lucide-react";
import { ClaimStatus, type Claim } from "@tpm/schemas";
import { keys, listClaims } from "@/api";
import { EmptyState } from "@/components/empty-state";
import { ClaimCard } from "@/components/knowledge/claim-card";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

const PAGE = 5;
const UNLINKED = "No column link";

const statusWords: Record<ClaimStatus | "open", string> = { open: "To review", hypothesis: "Hypothesis", stated: "Stated by a person", confirmed: "Confirmed", contradicted: "Contradicted" };

const topColumn = (claim: Claim): string => {
  const open = claim.links.filter((l) => l.confirmed !== false);
  const confirmed = open.find((l) => l.confirmed === true);
  return (confirmed ?? open[0])?.column ?? UNLINKED;
};

function Group({ column, claims }: { column: string; claims: Claim[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? claims : claims.slice(0, PAGE);
  return (
    <section aria-labelledby={`group-${column}`} className="flex flex-col gap-2">
      <h2 id={`group-${column}`} className="flex items-baseline gap-2 text-sm font-medium">
        <span className={column === UNLINKED ? "" : "font-mono"}>{column}</span>
        <span className="font-normal text-muted-foreground">({claims.length})</span>
      </h2>
      <div className="grid gap-2 xl:grid-cols-2">
        {shown.map((claim) => (
          <ClaimCard key={claim.id} claim={claim} />
        ))}
      </div>
      {claims.length > PAGE && (
        <Button size="xs" variant="outline" className="self-start" onClick={() => setAll((v) => !v)} aria-expanded={all}>
          {all ? "Show fewer" : `Show all ${claims.length}`}
        </Button>
      )}
    </section>
  );
}

export function ClaimsScreen() {
  const claims = useQuery({ queryKey: keys.claims, queryFn: listClaims, refetchInterval: 10000 });
  const [status, setStatus] = useState<ClaimStatus | "open">("open");
  const [text, setText] = useState("");
  const groups = useMemo(() => {
    const needle = text.trim().toLowerCase();
    const list = (claims.data ?? []).filter((c) => {
      if (status === "open" ? c.status === "confirmed" || c.status === "contradicted" : c.status !== status) return false;
      if (!needle) return true;
      return [c.statement, c.quote, c.sourceTitle, c.speaker ?? "", ...c.links.map((l) => l.column)].some((s) => s.toLowerCase().includes(needle));
    });
    const byColumn = new Map<string, Claim[]>();
    for (const c of list) byColumn.set(topColumn(c), [...(byColumn.get(topColumn(c)) ?? []), c]);
    return [...byColumn.entries()].sort((a, b) => (a[0] === UNLINKED ? 1 : b[0] === UNLINKED ? -1 : b[1].length - a[1].length));
  }, [claims.data, status, text]);
  const total = groups.reduce((n, [, list]) => n + list.length, 0);

  return (
    <>
      <PageHeader title="Review claims" description="Every claim the pipeline found, grouped by the column it points to. Confirm a claim to put it in the data spec, or contradict it.">
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Filter by text, column, or source" aria-label="Filter claims" className="w-64" />
        <Select value={status} onValueChange={(v) => setStatus(v as ClaimStatus | "open")}>
          <SelectTrigger className="w-44" aria-label="Claim status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="open">{statusWords.open}</SelectItem>
            {ClaimStatus.options.map((s) => (
              <SelectItem key={s} value={s}>
                {statusWords[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PageHeader>
      {claims.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : claims.isError ? (
        <EmptyState title="Claims not available" description={claims.error.message} />
      ) : total === 0 ? (
        <EmptyState icon={ListChecksIcon} title="Nothing to review" description={status === "open" ? "Every claim is confirmed or contradicted. New claims appear when a source arrives." : "No claim matches the filter."} />
      ) : (
        <div className="flex flex-col gap-6">
          <p className="text-sm text-muted-foreground">
            <span className="font-mono tabular-nums">{total}</span> claims in <span className="font-mono tabular-nums">{groups.length}</span> groups
          </p>
          {groups.map(([column, list]) => (
            <Group key={column} column={column} claims={list} />
          ))}
        </div>
      )}
    </>
  );
}
