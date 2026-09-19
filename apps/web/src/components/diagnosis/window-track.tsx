import { cn } from "cn";
import type { Window } from "@tpm/schemas";
import { useRun } from "@/hooks/use-run";

export function WindowTrack({ window, name, className }: { window: Window; name?: string; className?: string }) {
  const n = useRun().data?.timeBase.n;
  if (!n) return null;
  return (
    <span
      {...(name ? { role: "img", "aria-label": name } : { "aria-hidden": true })}
      className={cn("relative inline-block h-1.5 w-16 shrink-0 rounded-xs bg-muted", className)}
    >
      <span
        className="absolute inset-y-0 min-w-0.5 rounded-xs bg-chart-2"
        style={{ left: `calc(${window.from / n} * (100% - 0.125rem))`, width: `${(window.n / n) * 100}%` }}
      />
    </span>
  );
}
