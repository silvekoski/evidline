import { useQuery } from "@tanstack/react-query";
import type { LogEntry } from "@tpm/schemas";
import { getInference, keys } from "@/api";
import { ActionBar } from "@/components/action-bar";
import { ConfidenceBar } from "@/components/confidence-bar";
import { EvidenceChip } from "@/components/evidence-chip";
import { Skeleton } from "@/components/ui/skeleton";

export function LogEntryDetail({ entry }: { entry: LogEntry }) {
  return (
    <div className="flex flex-col gap-3">
      {entry.inferenceId && <InferencePanel id={entry.inferenceId} />}
      <dl className="grid gap-3 md:grid-cols-2">
        <JsonValue label="Before" value={entry.before} />
        <JsonValue label="After" value={entry.after} />
      </dl>
    </div>
  );
}

function InferencePanel({ id }: { id: string }) {
  const inference = useQuery({ queryKey: keys.inference(id), queryFn: () => getInference(id) });
  if (inference.isPending) return <Skeleton className="h-20 w-full" />;
  if (inference.isError) {
    return (
      <p className="text-sm text-muted-foreground">
        Inference <span className="font-mono">{id}</span> not available: {inference.error.message}
      </p>
    );
  }
  const inf = inference.data;
  return (
    <div className="flex flex-col gap-2 rounded-md border bg-card p-3">
      <div className="flex flex-wrap items-baseline gap-2 text-xs text-muted-foreground">
        <span className="font-mono">{inf.id}</span>
        <span>{inf.stage}</span>
        {inf.sensor && <span className="font-mono text-foreground">{inf.sensor}</span>}
      </div>
      <p className="text-sm">{inf.claim}</p>
      <div className="flex flex-wrap items-center gap-3">
        <ConfidenceBar value={inf.confidence} />
        <span className="inline-flex flex-wrap gap-1">
          {inf.evidenceIds.map((evidenceId) => (
            <EvidenceChip key={evidenceId} evidenceId={evidenceId} />
          ))}
        </span>
      </div>
      <ActionBar inference={inf} />
    </div>
  );
}

function JsonValue({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>
        <pre className="max-h-72 overflow-auto rounded-md border bg-card p-2 font-mono text-xs break-all whitespace-pre-wrap">{JSON.stringify(value ?? null, null, 2)}</pre>
      </dd>
    </div>
  );
}
