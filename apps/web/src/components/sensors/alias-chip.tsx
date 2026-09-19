import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { useOpenSensor } from "./use-open-sensor";

export function AliasChip({ alias, current = false, className }: { alias: string; current?: boolean; className?: string }) {
  const open = useOpenSensor();
  return (
    <Badge asChild variant={current ? "default" : "outline"} className={cn("cursor-pointer font-mono font-normal", !current && "hover:bg-muted", className)}>
      <button type="button" onClick={() => open(alias)} aria-label={`Open ${alias}`} aria-current={current ? "true" : undefined}>
        {alias}
      </button>
    </Badge>
  );
}
