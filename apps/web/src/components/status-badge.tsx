import type { ComponentProps } from "react";
import {
  BanIcon,
  PowerOffIcon,
  SendIcon,
  TriangleAlertIcon,
  CheckIcon,
  CircleDashedIcon,
  CircleHelpIcon,
  CircleIcon,
  CircleOffIcon,
  FileWarningIcon,
  PenIcon,
  RefreshCwIcon,
  TriangleIcon,
  TrendingUpIcon,
} from "lucide-react";
import { cn } from "cn";
import { faultFamily, healthToFault, type FaultFamily, type HealthClass, type InferenceStatus, type EgressRecord } from "@tpm/schemas";
import { Badge } from "@/components/ui/badge";

export type StatusKind = "healthy" | "drift" | FaultFamily | "hypothesis" | InferenceStatus | EgressRecord["status"];

const styles: Record<StatusKind, { icon: typeof CheckIcon | null; word: string; variant: ComponentProps<typeof Badge>["variant"]; className?: string }> = {
  sent: { icon: SendIcon, word: "sent", variant: "outline" },
  blocked: { icon: BanIcon, word: "blocked", variant: "default" },
  off: { icon: PowerOffIcon, word: "off", variant: "outline", className: "text-muted-foreground" },
  error: { icon: TriangleAlertIcon, word: "error", variant: "default" },
  healthy: { icon: CircleIcon, word: "Healthy", variant: "outline", className: "text-muted-foreground" },
  drift: { icon: TrendingUpIcon, word: "Drift", variant: "outline", className: "border-dashed border-foreground" },
  sensor: { icon: CircleOffIcon, word: "Sensor fault", variant: "default" },
  process: { icon: TriangleIcon, word: "Process fault", variant: "default" },
  data: { icon: FileWarningIcon, word: "Data fault", variant: "default" },
  hypothesis: { icon: null, word: "hypothesis", variant: "ghost", className: "italic px-0" },
  proposed: { icon: CircleDashedIcon, word: "proposed", variant: "ghost", className: "text-muted-foreground px-0" },
  accepted: { icon: CheckIcon, word: "accepted", variant: "ghost", className: "px-0" },
  questioned: { icon: CircleHelpIcon, word: "questioned", variant: "ghost", className: "px-0" },
  revised: { icon: RefreshCwIcon, word: "revised", variant: "ghost", className: "px-0" },
  overridden: { icon: PenIcon, word: "overridden", variant: "ghost", className: "px-0" },
};

export function healthKind(health: "healthy" | HealthClass): StatusKind {
  return health === "healthy" ? "healthy" : faultFamily(healthToFault(health));
}

export function StatusBadge({ kind, label, className }: { kind: StatusKind; label?: string; className?: string }) {
  const { icon: Icon, word, variant, className: kindClass } = styles[kind];
  return (
    <Badge variant={variant} className={cn("font-normal", kindClass, className)}>
      {Icon && <Icon aria-hidden="true" />}
      {kind === "hypothesis" && label ? `${label}, ${word}` : (label ?? word)}
    </Badge>
  );
}
