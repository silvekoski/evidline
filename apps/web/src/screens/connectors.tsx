import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PlugIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import { ConnectorKind, type Connector, type Job } from "@tpm/schemas";
import { assignUnassigned, createConnector, deleteConnector, keys, listConnectors, listJobs, listTextEgress, listUnassigned, listWorkspaces, retryJobs, syncConnector } from "@/api";
import { SourceKindBadge } from "@/components/knowledge/badges";
import { WorkspaceSettings } from "@/components/knowledge/workspace-settings";
import { connectorGaps } from "@/api";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { formatTime } from "@/lib/format";

const configHints: Record<ConnectorKind, { hint: string; example: string; secret: string }> = {
  upload: { hint: "No config. Signed upload links come from the Sources page.", example: "{}", secret: "none" },
  teams: { hint: "Entra app with application permissions. Organizers are the Norrin users that host customer calls.", example: '{"tenantId": "…", "clientId": "…", "organizers": ["anna@norrin.example"]}', secret: "client secret" },
  slack: { hint: "Internal Slack app in Socket Mode. Map each channel id to a workspace slug.", example: '{"appToken": "xapp-…", "channels": {"C0123": "acme"}}', secret: "bot token (xoxb-…)" },
  email: { hint: "Shared mailbox read through Graph with Mail.Read. The plus address maps a mail to a workspace.", example: '{"tenantId": "…", "clientId": "…", "mailbox": "corpus@norrin.example"}', secret: "client secret" },
};

function NewConnector({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ConnectorKind>("teams");
  const [name, setName] = useState("");
  const [config, setConfig] = useState("{}");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => createConnector({ kind, name, workspace: null, config: JSON.parse(config) as Record<string, unknown>, secret: secret || null }),
    onSuccess: () => {
      setOpen(false);
      onCreated();
    },
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <PlugIcon aria-hidden="true" /> Add connector
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            try {
              JSON.parse(config);
              setError(null);
              create.mutate();
            } catch {
              setError("The config must be valid JSON.");
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>Add connector</DialogTitle>
            <DialogDescription>{configHints[kind].hint}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="c-kind">Kind</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as ConnectorKind)}>
              <SelectTrigger id="c-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ConnectorKind.options.map((k) => (
                  <SelectItem key={k} value={k}>
                    {k}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="c-name">Name</Label>
            <Input id="c-name" value={name} required onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="c-config">Config (JSON)</Label>
            <Textarea id="c-config" value={config} rows={4} placeholder={configHints[kind].example} onChange={(e) => setConfig(e.target.value)} className="font-mono text-xs" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="c-secret">Secret ({configHints[kind].secret})</Label>
            <Input id="c-secret" type="password" value={secret} autoComplete="off" onChange={(e) => setSecret(e.target.value)} />
            <p className="text-xs text-muted-foreground">Stored with AES-256-GCM. The browser never gets it back.</p>
          </div>
          {error && <p className="text-sm">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={create.isPending || name.trim() === ""}>
              Add
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TranscriptGaps({ connectorId }: { connectorId: number }) {
  const [open, setOpen] = useState(false);
  const gaps = useQuery({ queryKey: keys.connectorGaps(connectorId), queryFn: () => connectorGaps(connectorId), enabled: open, retry: false });
  if (!open)
    return (
      <Button size="xs" variant="ghost" onClick={() => setOpen(true)}>
        Calls without a transcript
      </Button>
    );
  return (
    <div className="w-full text-xs" aria-live="polite">
      {gaps.isPending ? "Reading the calendar…" : gaps.isError ? gaps.error.message : gaps.data.length === 0 ? "Every customer call of the last 30 days has a transcript." : (
        <ul className="flex flex-col gap-1">
          {gaps.data.map((g, i) => (
            <li key={i}>
              {formatTime(g.start)}: {g.subject} ({g.domains.join(", ")})
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ConnectorCard({ connector, onChange }: { connector: Connector; onChange: () => void }) {
  const sync = useMutation({ mutationFn: () => syncConnector(connector.id), onSuccess: onChange });
  const remove = useMutation({ mutationFn: () => deleteConnector(connector.id), onSuccess: onChange });
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{connector.name}</CardTitle>
        <CardDescription>
          {connector.kind}, {connector.status}
          {connector.workspace ? `, workspace ${connector.workspace}` : ", all workspaces"}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-1 text-xs text-muted-foreground">
        <span>Last sync: {connector.lastSyncAt ? formatTime(connector.lastSyncAt) : "never"}</span>
        {connector.lastError && <span className="text-foreground">Last error: {connector.lastError}</span>}
        {connector.cursor && <span className="truncate font-mono">Cursor: {connector.cursor}</span>}
      </CardContent>
      <CardFooter className="flex-wrap gap-2">
        {connector.kind === "teams" && <TranscriptGaps connectorId={connector.id} />}
        {connector.kind !== "upload" && (
          <Button size="xs" variant="outline" onClick={() => sync.mutate()} disabled={sync.isPending}>
            <RefreshCwIcon aria-hidden="true" /> Sync now
          </Button>
        )}
        <Button size="xs" variant="ghost" aria-label={`Remove ${connector.name}`} onClick={() => confirm(`Remove ${connector.name}?`) && remove.mutate()}>
          <Trash2Icon aria-hidden="true" />
        </Button>
      </CardFooter>
    </Card>
  );
}

function UnassignedList() {
  const queryClient = useQueryClient();
  const rows = useQuery({ queryKey: keys.unassigned, queryFn: listUnassigned, refetchInterval: 10000 });
  const workspaces = useQuery({ queryKey: keys.workspaces, queryFn: listWorkspaces });
  const assign = useMutation({ mutationFn: ({ id, workspace }: { id: number; workspace: string }) => assignUnassigned(id, workspace), onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.unassigned }) });
  if (!rows.data?.length) return null;
  return (
    <section className="mt-6" aria-labelledby="unassigned-title">
      <h2 id="unassigned-title" className="mb-2 text-sm font-medium">
        Unassigned sources <span className="text-muted-foreground">({rows.data.length}). No rule matched a workspace, or more than one did.</span>
      </h2>
      <Table aria-label="Unassigned sources">
        <TableHeader>
          <TableRow>
            <TableHead scope="col" className="h-8">Source</TableHead>
            <TableHead scope="col" className="h-8">Connector</TableHead>
            <TableHead scope="col" className="h-8">Date</TableHead>
            <TableHead scope="col" className="h-8">Candidates</TableHead>
            <TableHead scope="col" className="h-8">Assign to</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.data.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="py-1">
                <SourceKindBadge value={row.kind} className="mr-2" />
                {row.title}
              </TableCell>
              <TableCell className="py-1">{row.connectorName}</TableCell>
              <TableCell className="py-1 text-xs">{formatTime(row.occurredAt)}</TableCell>
              <TableCell className="py-1 font-mono text-xs">{row.candidates.join(", ") || "none"}</TableCell>
              <TableCell className="py-1">
                <Select onValueChange={(workspace) => assign.mutate({ id: row.id, workspace })}>
                  <SelectTrigger size="sm" aria-label={`Assign ${row.title} to a workspace`}>
                    <SelectValue placeholder="Workspace" />
                  </SelectTrigger>
                  <SelectContent>
                    {(workspaces.data ?? []).map((w) => (
                      <SelectItem key={w.slug} value={w.slug}>
                        {w.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}

const jobLabel = (job: Job): string => `${job.type} ${JSON.stringify(job.payload).slice(0, 60)}`;

export function ConnectorsScreen() {
  const queryClient = useQueryClient();
  const connectors = useQuery({ queryKey: keys.connectors, queryFn: listConnectors, refetchInterval: 10000 });
  const jobs = useQuery({ queryKey: keys.jobs, queryFn: listJobs, refetchInterval: 5000 });
  const egress = useQuery({ queryKey: keys.textEgress, queryFn: listTextEgress, refetchInterval: 10000 });
  const retry = useMutation({ mutationFn: retryJobs, onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.jobs }) });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: keys.connectors });
  const failed = (jobs.data ?? []).filter((j) => j.status === "failed").length;

  return (
    <>
      <PageHeader title="Connectors" description="Teams transcripts, Slack channels, the shared mailbox, and upload links. Each source arrives with no manual step.">
        <NewConnector onCreated={refresh} />
      </PageHeader>
      <div className="mb-4">
        <WorkspaceSettings />
      </div>
      {connectors.isError ? (
        <EmptyState title="Connectors not available" description={connectors.error.message} />
      ) : (connectors.data ?? []).length === 0 ? (
        <EmptyState icon={PlugIcon} title="No connector" description="Upload works without a connector. Add Teams, Slack, or email to capture sources as they arrive." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {connectors.data!.map((c) => (
            <ConnectorCard key={c.id} connector={c} onChange={refresh} />
          ))}
        </div>
      )}
      <UnassignedList />
      <section className="mt-6" aria-labelledby="jobs-title">
        <div className="mb-2 flex items-center justify-between">
          <h2 id="jobs-title" className="text-sm font-medium">
            Jobs <span className="text-muted-foreground">({(jobs.data ?? []).filter((j) => j.status === "queued" || j.status === "running").length} queued, {failed} failed)</span>
          </h2>
          {failed > 0 && (
            <Button size="xs" variant="outline" onClick={() => retry.mutate()}>
              Retry failed
            </Button>
          )}
        </div>
        <Table aria-label="Jobs">
          <TableHeader>
            <TableRow>
              <TableHead scope="col" className="h-8">Job</TableHead>
              <TableHead scope="col" className="h-8">Status</TableHead>
              <TableHead scope="col" className="h-8 text-right">Tries</TableHead>
              <TableHead scope="col" className="h-8">Run after</TableHead>
              <TableHead scope="col" className="h-8">Error</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(jobs.data ?? []).slice(0, 30).map((job) => (
              <TableRow key={job.id}>
                <TableCell className="py-1 font-mono text-xs">{jobLabel(job)}</TableCell>
                <TableCell className="py-1">{job.status}</TableCell>
                <TableCell className="py-1 text-right font-mono">{job.attempts}</TableCell>
                <TableCell className="py-1 text-xs">{formatTime(job.runAfter)}</TableCell>
                <TableCell className="max-w-xs truncate py-1 text-xs text-muted-foreground" title={job.lastError ?? undefined}>{job.lastError}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
      <section className="mt-6" aria-labelledby="egress-title">
        <h2 id="egress-title" className="mb-2 text-sm font-medium">
          External calls of the corpus <span className="text-muted-foreground">(the log holds a hash, never the text)</span>
        </h2>
        <Table aria-label="Corpus egress log">
          <TableHeader>
            <TableRow>
              <TableHead scope="col" className="h-8">Time</TableHead>
              <TableHead scope="col" className="h-8">Purpose</TableHead>
              <TableHead scope="col" className="h-8">Destination</TableHead>
              <TableHead scope="col" className="h-8">Model</TableHead>
              <TableHead scope="col" className="h-8 text-right">Texts</TableHead>
              <TableHead scope="col" className="h-8 text-right">Bytes</TableHead>
              <TableHead scope="col" className="h-8">Status</TableHead>
              <TableHead scope="col" className="h-8">Hash</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(egress.data ?? []).slice(0, 50).map((row) => (
              <TableRow key={row.id}>
                <TableCell className="py-1 text-xs">{formatTime(row.time)}</TableCell>
                <TableCell className="py-1">{row.purpose}</TableCell>
                <TableCell className="py-1 font-mono text-xs">{row.destination}</TableCell>
                <TableCell className="py-1 font-mono text-xs">{row.model}</TableCell>
                <TableCell className="py-1 text-right font-mono">{row.texts}</TableCell>
                <TableCell className="py-1 text-right font-mono">{row.bytes}</TableCell>
                <TableCell className="py-1" title={row.detail}>{row.status}</TableCell>
                <TableCell className="py-1 font-mono text-xs">{row.payloadHash.slice(0, 12)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </>
  );
}
