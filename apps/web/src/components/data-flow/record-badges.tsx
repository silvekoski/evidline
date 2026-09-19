import { CheckIcon, MinusIcon, XIcon } from "lucide-react";
import { cn } from "cn";
import { GuardName, type GuardResult } from "@tpm/schemas";

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
