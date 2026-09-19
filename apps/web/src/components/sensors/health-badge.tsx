import { healthToFault, type HealthClass } from "@tpm/schemas";
import { FaultBadge } from "@/components/fault-badge";
import { StatusBadge } from "@/components/status-badge";

export function HealthBadge({ health }: { health: "healthy" | HealthClass }) {
  return health === "healthy" ? <StatusBadge kind="healthy" /> : <FaultBadge faultClass={healthToFault(health)} />;
}
