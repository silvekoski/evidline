import type { Window } from "@tpm/schemas";

export type DayLabel = ((sample: number) => string) | null;

export function SampleRange({ window, day }: { window: Window; day: DayLabel }) {
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1.5">
      <span className="font-mono text-xs tabular-nums">
        [{window.from}, {window.to})
      </span>
      {day && (
        <span className="text-xs text-muted-foreground">
          {day(window.from)} to {day(window.to)}
        </span>
      )}
    </span>
  );
}
