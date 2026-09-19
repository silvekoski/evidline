import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckIcon, XIcon } from "lucide-react";
import { GuardName, type EgressRecord, type Purpose } from "@tpm/schemas";
import { getInference, keys } from "@/api";
import { ActionBar } from "@/components/action-bar";
import { ConfidenceBar } from "@/components/confidence-bar";
import { EvidenceChip } from "@/components/evidence-chip";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatMs, formatTime } from "@/lib/format";
import { InferenceLink } from "./inference-link";
import { guardState, RecordStatusBadge } from "./record-badges";
import { HashMatch } from "./template-panel";

const linkClass = "rounded-sm font-mono text-xs underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{title}</h3>
      {children}
    </section>
  );
}

function Verbatim({ text, label }: { text: string; label: string }) {
  return (
    <pre role="region" aria-label={label} tabIndex={0} className="max-h-72 overflow-auto rounded-md bg-muted p-3 font-mono text-xs break-all whitespace-pre-wrap focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
      {text}
    </pre>
  );
}

function formatted(text: string): string | null {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return null;
  }
}

function PayloadView({ record }: { record: EgressRecord }) {
  const [view, setView] = useState<"verbatim" | "formatted">("verbatim");
  const pretty = formatted(record.payload);
  return (
    <Section title="What left">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          <span className="font-mono text-foreground tabular-nums">{record.payloadBytes.toLocaleString("en-US")}</span> bytes, the string that the gateway scanned and the provider sent unchanged.
        </span>
        <ToggleGroup type="single" variant="outline" size="sm" spacing={0} value={view} onValueChange={(value) => value && setView(value as typeof view)} aria-label="Payload view">
          <ToggleGroupItem value="verbatim">verbatim</ToggleGroupItem>
          <ToggleGroupItem value="formatted" disabled={pretty === null}>
            formatted
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      <Verbatim text={view === "formatted" && pretty !== null ? pretty : record.payload} label="Payload" />
    </Section>
  );
}

function LinkedInference({ id }: { id: string }) {
  const inference = useQuery({ queryKey: keys.inference(id), queryFn: () => getInference(id), staleTime: Infinity });
  if (inference.isError) return <p className="text-xs text-muted-foreground">Inference not available: {inference.error.message}</p>;
  if (!inference.data) return <Skeleton className="h-16 w-full" />;
  const inf = inference.data;
  return (
    <div className="flex flex-col gap-2">
      <p>
        <Badge variant="outline" className="mr-2 font-normal">
          {inf.stage}
        </Badge>
        {inf.claim}
      </p>
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

export function RecordDialog({
  record,
  runHashes,
  onClose,
}: {
  record: EgressRecord | null;
  runHashes: Partial<Record<Purpose, string>> | undefined;
  onClose: () => void;
}) {
  return (
    <Dialog open={record !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">{record && <RecordBody record={record} runHashes={runHashes} />}</DialogContent>
    </Dialog>
  );
}

function RecordBody({ record, runHashes }: { record: EgressRecord; runHashes: Partial<Record<Purpose, string>> | undefined }) {
  const provider = record.provider;
  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex flex-wrap items-center gap-2">
          <span className="font-mono">{record.id}</span>
          <RecordStatusBadge status={record.status} />
          {record.operatorText && (
            <Badge variant="outline" className="font-normal">
              operator text
            </Badge>
          )}
        </DialogTitle>
        <DialogDescription>
          <span className="font-mono">{record.purpose}</span>, mode {record.mode}, <time dateTime={record.time}>{formatTime(record.time)}</time>
          {record.durationMs !== null && <>, {formatMs(record.durationMs)}</>}
        </DialogDescription>
      </DialogHeader>
      <Section title="Which model">
        {provider === null ? (
          <p className="text-xs text-muted-foreground">{record.mode === "off" ? "None. The model was off, and a text template gave the answer." : "None. The mode had no provider, so nothing left."}</p>
        ) : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
            <dt className="text-muted-foreground">Provider</dt>
            <dd>{provider.name}</dd>
            <dt className="text-muted-foreground">Model</dt>
            <dd className="font-mono">{provider.model}</dd>
            <dt className="text-muted-foreground">Region</dt>
            <dd>{provider.region ?? "none"}</dd>
            <dt className="text-muted-foreground">Host</dt>
            <dd className="font-mono break-all">{provider.host}</dd>
          </dl>
        )}
      </Section>
      <Separator />
      <PayloadView record={record} />
      <Separator />
      <Section title="Proof">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead scope="col" className="h-8">Guard</TableHead>
              <TableHead scope="col" className="h-8">Result</TableHead>
              <TableHead scope="col" className="h-8">Detail</TableHead>
              <TableHead scope="col" className="h-8 text-right">Hits</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {GuardName.options.map((name) => {
              const result = record.guards.find((g) => g.name === name);
              const state = guardState(record.guards, name);
              return (
                <TableRow key={name} className="hover:bg-transparent">
                  <TableCell className="py-1 font-mono text-xs">{name}</TableCell>
                  <TableCell className="py-1">
                    <span className="inline-flex items-center gap-1">
                      {state === "pass" ? <CheckIcon className="size-3.5" aria-hidden="true" /> : state === "fail" ? <XIcon className="size-3.5" aria-hidden="true" /> : null}
                      {state}
                    </span>
                  </TableCell>
                  <TableCell className="py-1 text-xs whitespace-normal text-muted-foreground">{result?.detail ?? "an earlier guard failed first"}</TableCell>
                  <TableCell className="py-1 text-right font-mono text-xs tabular-nums">{result?.hits ?? ""}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <p className="text-xs">
          <span className="text-muted-foreground">Template hash </span>
          <span className="font-mono break-all">{record.templateHash}</span> <HashMatch hash={record.templateHash} runHash={runHashes?.[record.purpose]} />
        </p>
      </Section>
      <Separator />
      <Section title="What came back">
        {record.response === null ? <p className="text-xs text-muted-foreground">No response. {record.status === "off" ? "A text template gave the answer." : "Nothing came back."}</p> : <Verbatim text={record.response} label="Response" />}
        {record.validator === null ? (
          <p className="text-xs text-muted-foreground">Validator: not run.</p>
        ) : (
          <div className="flex flex-col gap-1">
            <Badge variant="outline" className="w-fit font-normal">
              {record.validator.pass ? <CheckIcon aria-hidden="true" /> : <XIcon aria-hidden="true" />}
              {record.validator.pass ? "validator passed" : `validator failed, ${record.validator.errors.length} ${record.validator.errors.length === 1 ? "error" : "errors"}`}
            </Badge>
            {record.validator.errors.length > 0 && (
              <ul className="list-disc pl-5 text-xs text-muted-foreground">
                {record.validator.errors.map((error, i) => (
                  <li key={i}>{error}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Section>
      <Separator />
      <Section title="Why">
        {record.inferenceId === null ? (
          <p className="text-xs text-muted-foreground">No linked inference.</p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              Linked inference <InferenceLink record={record} className={linkClass} />
            </p>
            <LinkedInference id={record.inferenceId} />
          </>
        )}
      </Section>
    </>
  );
}
