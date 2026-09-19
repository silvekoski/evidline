import { BanIcon, CheckIcon, MinusIcon, PowerOffIcon, SendIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import { cn } from "cn";
import { GuardName, type EgressRecord, type GuardResult } from "@tpm/schemas";
import { Badge } from "@/components/ui/badge";

type RecordStatus = EgressRecord["status"];

const statusStyles: Record<RecordStatus, { icon: typeof CheckIcon; variant: "default" | "outline"; className?: string }> = {
  sent: { icon: SendIcon, variant: "outline" },
  blocked: { icon: BanIcon, variant: "default" },
  off: { icon: PowerOffIcon, variant: "outline", className: "text-muted-foreground" },
  error: { icon: TriangleAlertIcon, variant: "default" },
};

export function RecordStatusBadge({ status, className }: { status: RecordStatus; className?: string }) {
  const { icon: Icon, variant, className: statusClass } = statusStyles[status];
  return (
    <Badge variant={variant} className={cn("font-normal", statusClass, className)}>
      <Icon aria-hidden="true" />
      {status}
    </Badge>
  );
}

type GuardState = "pass" | "fail" | "not run";

export function guardState(guards: GuardResult[], name: GuardName): GuardState {
  const result = guards.find((g) => g.name === name);
  return result === undefined ? "not run" : result.pass ? "pass" : "fail";
}

const stateIcon: Record<GuardState, typeof CheckIcon> = { pass: CheckIcon, fail: XIcon, "not run": MinusIcon };

export function GuardMarks({ guards }: { guards: GuardResult[] }) {
  return (
    <ol className="inline-flex items-center gap-0.5" aria-label="Guards">
      {GuardName.options.map((name) => {
        const state = guardState(guards, name);
        const Icon = stateIcon[state];
        return (
          <li
            key={name}
            title={`${name}: ${state}`}
            className={cn(
              "inline-flex size-4 items-center justify-center rounded-xs border border-foreground",
              state === "fail" && "bg-foreground text-background",
              state === "not run" && "border-dashed border-muted-foreground text-muted-foreground",
            )}
          >
            <Icon className="size-3" aria-hidden="true" />
            <span className="sr-only">
              {name} {state}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
