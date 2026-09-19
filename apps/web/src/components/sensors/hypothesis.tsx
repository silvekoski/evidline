import { StatusBadge } from "@/components/status-badge";

export function Hypothesis({ name }: { name: string | null }) {
  return name ? <StatusBadge kind="hypothesis" label={name} /> : <span className="text-xs text-muted-foreground">no hypothesis (model off)</span>;
}
