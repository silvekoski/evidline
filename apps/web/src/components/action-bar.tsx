import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { CheckIcon, CircleHelpIcon, PenIcon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import {
  FaultClass,
  Role,
  faultLabel,
  type ActionResponse,
  type Inference,
  type OverrideValue,
  type ThreadEntry,
} from "@tpm/schemas";
import { acceptInference, getSensors, getThread, keys, overrideInference, questionInference } from "@/api";
import { requestAction, useActionRequest } from "@/hooks/use-action-request";
import { useLens } from "@/hooks/use-lens";
import { screenForStage, screenPath } from "@/layout/screens";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatTime } from "@/lib/format";
import { EvidenceChip } from "./evidence-chip";
import { StatusBadge } from "./status-badge";

export function ActionBar({ inference, className }: { inference: Inference; className?: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const thread = useQuery({
    queryKey: keys.thread(inference.id),
    queryFn: () => getThread(inference.id),
    enabled: inference.status !== "proposed" || inference.supersedes !== null,
  });

  const settle = (response: ActionResponse) => {
    queryClient.setQueryData(keys.thread(inference.id), response.thread);
    void queryClient.invalidateQueries();
    return response;
  };

  const accept = useMutation({
    mutationFn: () => acceptInference(inference.id),
    onSuccess: (response) => {
      settle(response);
      toast.success(`Accepted ${inference.id}`);
    },
  });
  const question = useMutation({
    mutationFn: (text: string) => questionInference(inference.id, text),
    onSuccess: (response) => {
      settle(response);
      const verdict = response.thread.findLast((entry) => entry.kind === "verdict");
      toast.success(response.changed.length ? "Inference revised" : "Inference confirmed", { description: verdict?.text });
    },
  });
  const override = useMutation({
    mutationFn: (input: { value: OverrideValue; reason: string }) => overrideInference(inference.id, input.value, input.reason),
    onSuccess: (response) => {
      settle(response);
      const rerunId = response.rerunId;
      toast.success("Override stored", {
        description: `${response.changed.length} inference${response.changed.length === 1 ? "" : "s"} changed in the rerun.`,
        action: rerunId ? { label: "Open rerun", onClick: () => navigate(screenPath(rerunId, screenForStage[inference.stage])) } : undefined,
      });
    },
  });

  const canOverride = inference.stage === "role" || inference.stage === "diagnosis" || inference.stage === "baseline" || inference.stage === "drift";

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge kind={inference.status} />
        <Button size="sm" variant="outline" onClick={() => accept.mutate()} disabled={accept.isPending || inference.status === "accepted"}>
          <CheckIcon aria-hidden="true" />
          Accept
        </Button>
        <QuestionDialog inferenceId={inference.id} pending={question.isPending} onSubmit={(text) => question.mutateAsync(text)} />
        {canOverride && <OverrideDialog inference={inference} pending={override.isPending} onSubmit={(value, reason) => override.mutateAsync({ value, reason })} />}
      </div>
      {thread.data?.length ? <Thread entries={thread.data} /> : null}
    </div>
  );
}

function QuestionDialog({ inferenceId, pending, onSubmit }: { inferenceId: string; pending: boolean; onSubmit: (text: string) => Promise<unknown> }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const lens = useLens();
  const requested = useActionRequest(inferenceId, "question");
  useEffect(() => {
    if (requested?.kind !== "question") return;
    setText(requested.text.slice(0, 500));
    setOpen(true);
    requestAction(null);
  }, [requested]);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <CircleHelpIcon aria-hidden="true" />
          Question
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Question this inference</DialogTitle>
          <DialogDescription>The agent plans tests from a fixed tool catalog, runs them in the {lens.plant}, and answers in the thread.</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={async (event) => {
            event.preventDefault();
            await onSubmit(text.trim());
            setText("");
            setOpen(false);
          }}
        >
          <Label htmlFor="question-text">Question or hunch</Label>
          <Textarea id="question-text" value={text} onChange={(e) => setText(e.target.value)} maxLength={500} required placeholder="I think someone replaced the steam valve around week three." />
          <DialogFooter>
            <Button type="submit" disabled={pending || text.trim().length === 0}>
              Ask
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function OverrideDialog({
  inference,
  pending,
  onSubmit,
}: {
  inference: Inference;
  pending: boolean;
  onSubmit: (value: OverrideValue, reason: string) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [value, setValue] = useState<OverrideValue | null>(() => initialOverride(inference));
  const lens = useLens();
  const requested = useActionRequest(inference.id, "override");
  useEffect(() => {
    if (requested?.kind !== "override") return;
    setValue(requested.value);
    setReason(requested.reason.slice(0, 500));
    setOpen(true);
    requestAction(null);
  }, [requested]);
  const sensors = useQuery({
    queryKey: keys.sensors(inference.runId),
    queryFn: () => getSensors(inference.runId),
    enabled: open && inference.stage === "drift",
  });
  const control = ((): ReactNode => {
    switch (inference.stage) {
      case "role":
        return (
          <Field label="Role" id="override-role">
            <Select value={value?.kind === "role" ? value.role : inference.value.role} onValueChange={(role) => setValue({ kind: "role", role: role as Role })}>
              <SelectTrigger id="override-role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Role.options.map((role) => (
                  <SelectItem key={role} value={role}>
                    {role}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        );
      case "diagnosis":
        return (
          <>
            <Field label="Override" id="override-kind">
              <Select
                value={value?.kind === "responsible" ? "responsible" : "faultClass"}
                onValueChange={(kind) => setValue(kind === "responsible"
                  ? { kind: "responsible", sensor: inference.value.ranked[0]?.sensor ?? "" }
                  : { kind: "faultClass", faultClass: inference.value.faultClass })}
              >
                <SelectTrigger id="override-kind" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="faultClass">Fault class</SelectItem>
                  <SelectItem value="responsible" disabled={inference.value.ranked.length === 0}>Responsible {lens.sensor}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {value?.kind === "responsible" ? (
              <Field label={`Responsible ${lens.sensor}`} id="override-responsible">
                <Select value={value.sensor} onValueChange={(sensor) => setValue({ kind: "responsible", sensor })}>
                  <SelectTrigger id="override-responsible" className="w-full font-mono">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {inference.value.ranked.map(({ sensor }) => <SelectItem key={sensor} value={sensor}>{sensor}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            ) : (
              <Field label="Fault class" id="override-fault">
                <Select
                  value={value?.kind === "faultClass" ? value.faultClass : inference.value.faultClass}
                  onValueChange={(faultClass) => setValue({ kind: "faultClass", faultClass: faultClass as FaultClass })}
                >
                  <SelectTrigger id="override-fault" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FaultClass.options.map((fc) => (
                      <SelectItem key={fc} value={fc}>
                        {faultLabel(fc)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          </>
        );
      case "baseline": {
        const window = value?.kind === "baseline" ? value.window : inference.value.window;
        const setWindow = (from: number, to: number) => setValue({ kind: "baseline", window: { from, to, n: Math.max(0, to - from) } });
        return (
          <div className="grid grid-cols-2 gap-3">
            <Field label="From (sample)" id="override-from">
              <Input id="override-from" type="number" inputMode="numeric" min={0} value={window.from} onChange={(e) => setWindow(Number(e.target.value), window.to)} className="font-mono" />
            </Field>
            <Field label="To (sample)" id="override-to">
              <Input id="override-to" type="number" inputMode="numeric" min={0} value={window.to} onChange={(e) => setWindow(window.from, Number(e.target.value))} className="font-mono" />
            </Field>
          </div>
        );
      }
      case "drift":
        return (
          <Field label={`Responsible ${lens.sensor}`} id="override-sensor">
            <Select value={value?.kind === "responsible" ? value.sensor : (inference.value.responsible ?? "")} onValueChange={(sensor) => setValue({ kind: "responsible", sensor })}>
              <SelectTrigger id="override-sensor" className="w-full font-mono">
                <SelectValue placeholder={sensors.isPending ? "Loading" : `Pick a ${lens.sensor}`} />
              </SelectTrigger>
              <SelectContent>
                {(sensors.data?.sensors ?? []).map((s) => (
                  <SelectItem key={s.alias} value={s.alias} className="font-mono">
                    {s.alias}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        );
      default:
        return null;
    }
  })();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <PenIcon aria-hidden="true" />
          Override
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Override this inference</DialogTitle>
          <DialogDescription>The agent stores the override, runs the later stages again with it as a fact, and shows what changed.</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!value) return;
            await onSubmit(value, reason.trim());
            setReason("");
            setValue(initialOverride(inference));
            setOpen(false);
          }}
        >
          {control}
          <Field label="Reason" id="override-reason">
            <Textarea id="override-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} required placeholder="Why the agent is wrong here." />
          </Field>
          <DialogFooter>
            <Button type="submit" disabled={pending || value === null || reason.trim().length === 0}>
              Store override
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function initialOverride(inference: Inference): OverrideValue | null {
  switch (inference.stage) {
    case "role":
      return { kind: "role", role: inference.value.role };
    case "diagnosis":
      return { kind: "faultClass", faultClass: inference.value.faultClass };
    case "baseline":
      return { kind: "baseline", window: inference.value.window };
    case "drift":
      return inference.value.responsible ? { kind: "responsible", sensor: inference.value.responsible } : null;
    default:
      return null;
  }
}

function Field({ label, id, children }: { label: string; id: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

function Thread({ entries }: { entries: ThreadEntry[] }) {
  return (
    <ol className="flex flex-col gap-2 border-l pl-3 text-sm">
      {entries.map((entry) => (
        <li key={entry.id} className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{entry.kind}</span>
            <time dateTime={entry.time}>{formatTime(entry.time)}</time>
            {entry.egressId && <span className="font-mono">{entry.egressId}</span>}
          </div>
          <p>{entry.text}</p>
          {entry.evidenceIds.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {entry.evidenceIds.map((id) => (
                <EvidenceChip key={id} evidenceId={id} />
              ))}
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}
