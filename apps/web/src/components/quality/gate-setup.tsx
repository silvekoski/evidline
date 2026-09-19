import { useEffect, useState, type ReactNode } from "react";
import { cn } from "cn";
import type { BaselineInference, CalibrationInference } from "@tpm/schemas";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { BaselineDetail } from "./baseline-detail";
import { CalibrationDetail, calibrationSummary } from "./calibration-detail";
import { SampleRange, type DayLabel } from "./sample-range";

const calibrationTitles = ["Health calibration", "Drift calibration"];

type Row = { id: string; title: string; summary: ReactNode; detail: ReactNode };

export function GateSetup({ baseline, calibration, day, targetId }: { baseline: BaselineInference; calibration: CalibrationInference[]; day: DayLabel; targetId: string | null }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const rows: Row[] = [
    {
      id: baseline.id,
      title: "Baseline",
      summary: (
        <>
          <SampleRange window={baseline.value.window} day={day} />
          <span>
            , {baseline.value.window.n.toLocaleString("en-US")} samples, {baseline.value.changepoints.length} change {baseline.value.changepoints.length === 1 ? "point" : "points"}
          </span>
        </>
      ),
      detail: <BaselineDetail inference={baseline} day={day} />,
    },
    ...[...calibration]
      .sort((a, b) => a.seq - b.seq)
      .map((inference, i) => {
        const title = calibrationTitles[i] ?? "Calibration";
        return { id: inference.id, title, summary: calibrationSummary(inference.value), detail: <CalibrationDetail inference={inference} title={title} day={day} /> };
      }),
  ];
  const open = rows.find((r) => r.id === openId);

  const ids = rows.map((r) => r.id).join(" ");
  useEffect(() => {
    if (targetId && ids.split(" ").includes(targetId)) setOpenId(targetId);
  }, [targetId, ids]);

  return (
    <section aria-label="Gate setup" className="flex flex-col divide-y rounded-lg border">
      {rows.map((row) => (
        <div key={row.id} id={row.id} tabIndex={-1} className={cn("grid items-center gap-x-3 gap-y-1 px-3 py-1.5 text-sm sm:grid-cols-[10rem_1fr_auto]", row.id === targetId && "ring-1 ring-foreground/40")}>
          <span className="font-medium">
            {row.title} <span className="ml-1 font-mono text-xs font-normal text-muted-foreground">{row.id.replace(/^inf-[0-9a-f]+-/, "")}</span>
          </span>
          <span className="text-muted-foreground">{row.summary}</span>
          <Button variant="link" size="sm" className="h-7 justify-self-start px-0 sm:justify-self-end" onClick={() => setOpenId(row.id)}>
            Details
          </Button>
        </div>
      ))}
      <Sheet open={open !== undefined} onOpenChange={(next) => !next && setOpenId(null)}>
        <SheetContent className="overflow-y-auto data-[side=right]:sm:max-w-2xl">
          {open && (
            <>
              <SheetHeader>
                <SheetTitle>
                  {open.title} <span className="font-mono text-xs font-normal text-muted-foreground">{open.id}</span>
                </SheetTitle>
                <SheetDescription>{open.title === "Baseline" ? "The reference segment for every health check." : "How the agent set the thresholds and how many injected faults it caught."}</SheetDescription>
              </SheetHeader>
              <div className="px-4 pb-4">{open.detail}</div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </section>
  );
}
