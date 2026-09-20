import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { CopyIcon, DownloadIcon, FileTextIcon, MessageCircleQuestionIcon } from "lucide-react";
import { toast } from "sonner";
import type { DataSpec } from "@tpm/schemas";
import { buildSpec, keys, listClaims } from "@/api";
import { EmptyState } from "@/components/empty-state";
import { sourceHref } from "@/components/knowledge/locator";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { formatTime } from "@/lib/format";

const markdown = (spec: DataSpec): string => {
  const byColumn = new Map<string, DataSpec["sentences"]>();
  for (const s of spec.sentences) byColumn.set(s.column, [...(byColumn.get(s.column) ?? []), s]);
  return [
    `# Data spec, ${spec.workspace}`,
    "",
    `Generated ${spec.generatedAt}. Each sentence cites its claim ids.`,
    "",
    ...[...byColumn.entries()].flatMap(([column, list]) => [`## ${column}`, "", ...list.map((s) => `- ${s.text} [${s.claimIds.map((id) => `claim ${id}`).join(", ")}]`), ""]),
    "## Columns without a confirmed claim",
    "",
    ...spec.columnsWithoutClaims.map((c) => `- ${c}`),
  ].join("\n");
};

type MissingColumn = { column: string; base: string; stat: string | null; sliced: boolean };

const columnPattern = /^([A-Za-z][\w]*)(?:\.([A-Za-z0-9]+))?(\[.+\])?$/;

const parseColumn = (column: string): MissingColumn => {
  const m = column.match(columnPattern);
  return m ? { column, base: m[1]!, stat: m[2] ?? null, sliced: m[3] !== undefined } : { column, base: column, stat: null, sliced: false };
};

const naturalCompare = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

const groupMissingColumns = (columns: string[]): { plain: MissingColumn[]; groups: [string, MissingColumn[]][] } => {
  const byBase = new Map<string, MissingColumn[]>();
  for (const column of columns) {
    const parsed = parseColumn(column);
    byBase.set(parsed.base, [...(byBase.get(parsed.base) ?? []), parsed]);
  }
  const plain: MissingColumn[] = [];
  const groups: [string, MissingColumn[]][] = [];
  for (const [base, items] of byBase) {
    if (items.length === 1 && items[0]!.stat === null && !items[0]!.sliced) plain.push(items[0]!);
    else groups.push([base, items]);
  }
  plain.sort((a, b) => naturalCompare(a.column, b.column));
  groups.sort(([a], [b]) => naturalCompare(a, b));
  return { plain, groups };
};

function MissingColumnBadge({ item, pending, label }: { item: MissingColumn; pending: number; label: string }) {
  return (
    <Badge variant={pending > 0 ? "secondary" : "outline"} className="gap-1 font-mono" title={item.column}>
      {pending > 0 && <MessageCircleQuestionIcon aria-hidden="true" className="size-3" />}
      {label}
      {pending > 0 && (
        <span className="sr-only">
          , {pending} claim{pending === 1 ? "" : "s"} to review
        </span>
      )}
    </Badge>
  );
}

const download = (name: string, type: string, text: string): void => {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
};

export function SpecScreen() {
  const spec = useQuery({ queryKey: keys.spec, queryFn: buildSpec });
  const claims = useQuery({ queryKey: keys.claims, queryFn: listClaims });
  const claimById = new Map((claims.data ?? []).map((c) => [c.id, c]));
  const byColumn = new Map<string, DataSpec["sentences"]>();
  for (const s of spec.data?.sentences ?? []) byColumn.set(s.column, [...(byColumn.get(s.column) ?? []), s]);
  const pendingByColumn = new Map<string, number>();
  for (const c of claims.data ?? []) for (const column of new Set(c.links.map((l) => l.column))) pendingByColumn.set(column, (pendingByColumn.get(column) ?? 0) + 1);

  return (
    <>
      <PageHeader title="Data spec" description="Built from confirmed claims with a confirmed column link only. Each sentence shows its claim ids.">
        {spec.data && (
          <>
            <span className="text-xs text-muted-foreground">Generated {formatTime(spec.data.generatedAt)}</span>
            <Button size="sm" variant="outline" onClick={() => spec.refetch()}>
              Build again
            </Button>
            <Button size="sm" variant="outline" onClick={() => download(`data-spec-${spec.data.workspace}.json`, "application/json", JSON.stringify(spec.data, null, 2))}>
              <DownloadIcon aria-hidden="true" /> JSON
            </Button>
            <Button size="sm" variant="outline" onClick={() => download(`data-spec-${spec.data.workspace}.md`, "text/markdown", markdown(spec.data))}>
              <DownloadIcon aria-hidden="true" /> Markdown
            </Button>
            <Button
              size="sm"
              onClick={async () => {
                await navigator.clipboard.writeText(markdown(spec.data));
                toast.success("Spec copied as markdown");
              }}
            >
              <CopyIcon aria-hidden="true" /> Copy
            </Button>
          </>
        )}
      </PageHeader>
      {spec.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : spec.isError ? (
        <EmptyState title="Spec not available" description={spec.error.message} />
      ) : spec.data.sentences.length === 0 ? (
        <EmptyState icon={FileTextIcon} title="No confirmed claim" description="Confirm a claim and its column link on a source page or in the Knowledge tab of a column. The spec then shows it here." />
      ) : (
        <div className="flex flex-col gap-6">
          <section aria-label="Coverage" className="flex flex-col gap-1">
            <p className="text-sm">
              <span className="font-mono tabular-nums">{byColumn.size}</span> of <span className="font-mono tabular-nums">{byColumn.size + spec.data.columnsWithoutClaims.length}</span> columns have a confirmed sentence.
            </p>
            <Progress value={(100 * byColumn.size) / Math.max(1, byColumn.size + spec.data.columnsWithoutClaims.length)} aria-label="Columns with a confirmed sentence" className="h-1.5" />
          </section>
          {[...byColumn.entries()].map(([column, list]) => (
            <section key={column} aria-labelledby={`spec-${column}`}>
              <h2 id={`spec-${column}`} className="mb-2 font-mono text-sm font-medium">
                {column}
              </h2>
              <ul className="flex flex-col gap-1">
                {list.map((s, i) => (
                  <li key={i} className="flex flex-wrap items-baseline gap-2 text-sm">
                    <span>{s.text}</span>
                    {s.claimIds.map((id) => {
                      const claim = claimById.get(id);
                      return claim ? (
                        <Link key={id} to={sourceHref(claim.sourceId, claim.locator, claim.quote)} className="font-mono text-xs underline-offset-4 hover:underline">
                          claim {id}
                        </Link>
                      ) : (
                        <Badge key={id} variant="outline" className="font-mono">
                          claim {id}
                        </Badge>
                      );
                    })}
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {spec.data.columnsWithoutClaims.length > 0 && (
            <section aria-labelledby="spec-missing" className="flex flex-col gap-4">
              <h2 id="spec-missing" className="text-sm font-medium">
                Columns without a confirmed claim ({spec.data.columnsWithoutClaims.length})
              </h2>
              {(() => {
                const { plain, groups } = groupMissingColumns(spec.data.columnsWithoutClaims);
                return (
                  <>
                    {groups.length > 0 && (
                      <ul className="flex flex-col gap-2">
                        {groups.map(([base, items]) => {
                          const bare = items.find((p) => p.stat === null && !p.sliced) ?? null;
                          const stats = items.filter((p) => p.stat !== null && !p.sliced);
                          const sliced = items.filter((p) => p.sliced);
                          const barePending = bare ? (pendingByColumn.get(bare.column) ?? 0) : 0;
                          return (
                            <li key={base} className="rounded-md border p-2.5">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="mr-1 inline-flex items-center gap-1 font-mono text-xs font-medium" title={bare ? "No confirmed claim about this column itself" : undefined}>
                                  {barePending > 0 && <MessageCircleQuestionIcon aria-hidden="true" className="size-3 text-muted-foreground" />}
                                  {base}
                                </span>
                                {stats.map((p) => (
                                  <MissingColumnBadge key={p.column} item={p} pending={pendingByColumn.get(p.column) ?? 0} label={p.stat!} />
                                ))}
                              </div>
                              {sliced.length > 0 && (
                                <details className="mt-2">
                                  <summary className="cursor-pointer text-xs text-muted-foreground underline-offset-4 hover:underline">
                                    {sliced.length} sliced by value
                                  </summary>
                                  <ul className="mt-2 flex flex-wrap gap-1.5">
                                    {sliced.map((p) => (
                                      <li key={p.column}>
                                        <MissingColumnBadge item={p} pending={pendingByColumn.get(p.column) ?? 0} label={p.column.slice(base.length)} />
                                      </li>
                                    ))}
                                  </ul>
                                </details>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    {plain.length > 0 && (
                      <div className="flex flex-col gap-1.5">
                        <p className="text-xs text-muted-foreground">{plain.length} column{plain.length === 1 ? "" : "s"} with no statistic yet</p>
                        <ul className="flex flex-wrap gap-1.5" aria-label="Columns with no statistic">
                          {plain.map((p) => (
                            <li key={p.column}>
                              <MissingColumnBadge item={p} pending={pendingByColumn.get(p.column) ?? 0} label={p.column} />
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                );
              })()}
              <Button asChild size="xs" variant="outline" className="self-start">
                <Link to="/open-questions">Answer the open questions</Link>
              </Button>
            </section>
          )}
        </div>
      )}
    </>
  );
}
