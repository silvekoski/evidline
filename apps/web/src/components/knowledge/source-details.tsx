import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import type { Source } from "@tpm/schemas";
import { getSourceClaims, keys } from "@/api";
import { OcrBadge, SourceKindBadge } from "./badges";
import { ClaimCard } from "./claim-card";
import { SourceStatusText } from "./source-status";
import { SourceSteps } from "./source-steps";
import { formatBytes, formatTime, shortHash } from "@/lib/format";

const listPages = (pages: number[]): string => (pages.length === 1 ? `page ${pages[0]}` : `pages ${pages.slice(0, -1).join(", ")} and ${pages[pages.length - 1]}`);

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[5rem_1fr] gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

export function SourceDetails({ source }: { source: Source }) {
  const claims = useQuery({ queryKey: keys.sourceClaims(source.id), queryFn: () => getSourceClaims(source.id), refetchInterval: 5000 });
  const ocrRead = source.status === "processed" && source.ocrPages.length > 0;
  return (
    <div className="flex flex-col gap-6 p-4 text-sm">
      <section aria-labelledby="details-heading">
        <h2 id="details-heading" className="mb-3 font-medium">
          Details
        </h2>
        <dl className="flex flex-col gap-2">
          <Row label="Kind">
            <SourceKindBadge value={source.kind} />
          </Row>
          <Row label="Status">
            <SourceStatusText status={source.status} />
          </Row>
          <Row label="Date">{formatTime(source.occurredAt)}</Row>
          <Row label="Received">{formatTime(source.createdAt)}</Row>
          <Row label="Size">
            {formatBytes(source.bytes)}
            {source.pages ? `, ${source.pages} pages` : ""}
          </Row>
          <Row label="Type">
            <span className="font-mono text-xs">{source.mediaType}</span>
          </Row>
          <Row label="Hash">
            <span className="font-mono text-xs" title={source.contentHash}>
              {shortHash(source.contentHash)}
            </span>
          </Row>
          {source.runId && (
            <Row label="Run">
              <Link to={`/runs/${source.runId}/sensors`} className="font-mono text-xs underline-offset-4 hover:underline">
                {source.runId}
              </Link>
            </Row>
          )}
        </dl>
      </section>
      <section aria-labelledby="pipeline-heading">
        <h2 id="pipeline-heading" className="mb-3 font-medium">
          Pipeline
        </h2>
        <SourceSteps source={source} className="flex-col gap-y-1.5" />
        {source.error && <p className="mt-3 rounded-md border p-2 text-xs">{source.error}</p>}
        {ocrRead && (
          <p className="mt-3 flex items-start gap-2 rounded-md border border-dashed p-2 text-xs">
            <OcrBadge className="shrink-0" />
            <span>A model read {listPages(source.ocrPages)} from the page image, because the PDF has no text layer there. Compare a quote from these pages with the page before you confirm a claim.</span>
          </p>
        )}
      </section>
      <section aria-labelledby="claims-heading" className="flex flex-col gap-2">
        <h2 id="claims-heading" className="mb-1 font-medium">
          Claims ({claims.data?.length ?? 0})
        </h2>
        {claims.data?.length === 0 && <p className="text-muted-foreground">No claim yet. Claims appear after the extraction job runs.</p>}
        {(claims.data ?? []).map((claim) => (
          <ClaimCard key={claim.id} claim={claim} showSource={false} />
        ))}
      </section>
    </div>
  );
}
