import { faultFamily, faultLabel, type FaultClass } from "@tpm/schemas";
import { StatusBadge } from "./status-badge";

export function FaultBadge({ faultClass, className }: { faultClass: FaultClass; className?: string }) {
  return <StatusBadge kind={faultFamily(faultClass)} label={faultLabel(faultClass)} className={className} />;
}
