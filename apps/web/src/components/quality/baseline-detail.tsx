import type { BaselineInference } from "@tpm/schemas";
import { InferenceFooter } from "./inference-footer";
import { SampleRange, type DayLabel } from "./sample-range";

export function BaselineDetail({ inference, day }: { inference: BaselineInference; day: DayLabel }) {
  const { window, changepoints } = inference.value;
  const shown = changepoints.slice(0, 5);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">The longest early segment with no change point and no failed check. Each health check compares a window with this segment.</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Window</dt>
        <dd>
          <SampleRange window={window} day={day} />
        </dd>
        <dt className="text-muted-foreground">Samples</dt>
        <dd className="font-mono tabular-nums">{window.n.toLocaleString("en-US")}</dd>
        <dt className="text-muted-foreground">Change points</dt>
        <dd className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-mono tabular-nums">{changepoints.length}</span>
          {shown.length > 0 && (
            <span className="text-xs text-muted-foreground">
              at {shown.map((cp) => (day ? `${cp} (${day(cp)})` : String(cp))).join(", ")}
              {changepoints.length > shown.length ? ` and ${changepoints.length - shown.length} more` : ""}
            </span>
          )}
        </dd>
      </dl>
      <p>{inference.claim}</p>
      <InferenceFooter inference={inference} />
    </div>
  );
}
