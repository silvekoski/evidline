import { CheckIcon, CircleXIcon, DatabaseIcon, LoaderIcon, ScanTextIcon } from "lucide-react";
import { cn } from "cn";
import type { SourceStatus } from "@tpm/schemas";
import { sourceStatusWord } from "./badges";

const icons: Record<SourceStatus, typeof CheckIcon> = {
  received: LoaderIcon,
  processing: LoaderIcon,
  processed: CheckIcon,
  failed: CircleXIcon,
  needs_ocr: ScanTextIcon,
  sensor_data: DatabaseIcon,
};

export const isBusy = (status: SourceStatus) => status === "received" || status === "processing";
export const needsAttention = (status: SourceStatus) => status === "failed" || status === "needs_ocr";

export function SourceStatusText({ status, className }: { status: SourceStatus; className?: string }) {
  const Icon = icons[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5", status === "processed" && "text-muted-foreground", className)}>
      <Icon aria-hidden="true" className={cn("size-3.5", isBusy(status) && "motion-safe:animate-spin")} />
      {sourceStatusWord[status]}
    </span>
  );
}
