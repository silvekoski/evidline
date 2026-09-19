import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChartLineIcon } from "lucide-react";
import { cn } from "cn";
import { getEvidence, keys } from "@/api";
import { openEvidence } from "@/hooks/use-evidence-sheet";
import { Badge } from "@/components/ui/badge";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Skeleton } from "@/components/ui/skeleton";

export function EvidenceChip({ evidenceId, label, className }: { evidenceId: string; label?: string; className?: string }) {
  const [hovered, setHovered] = useState(false);
  const evidence = useQuery({ queryKey: keys.evidence(evidenceId), queryFn: () => getEvidence(evidenceId), enabled: hovered });
  const short = label ?? evidenceId.replace(/^ev-[0-9a-f]+-/, "ev-");
  return (
    <HoverCard openDelay={200} onOpenChange={setHovered}>
      <HoverCardTrigger asChild>
        <Badge asChild variant="outline" className={cn("cursor-pointer font-mono font-normal hover:bg-muted", className)}>
          <button type="button" onClick={() => openEvidence(evidenceId)} aria-label={`Open evidence ${evidenceId}`}>
            <ChartLineIcon aria-hidden="true" />
            {short}
          </button>
        </Badge>
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-72 text-xs">
        {evidence.data ? (
          <div className="flex flex-col gap-1">
            <div className="flex justify-between gap-2 text-muted-foreground">
              <span>
                {evidence.data.kind}, {evidence.data.method}
              </span>
              <span className="font-mono">{evidence.data.sensors.join(", ")}</span>
            </div>
            <p>{evidence.data.verdict}</p>
            <p className="text-muted-foreground">Click to open the chart and the numbers.</p>
          </div>
        ) : evidence.isError ? (
          <p>{evidence.error.message}</p>
        ) : (
          <Skeleton className="h-10 w-full" />
        )}
      </HoverCardContent>
    </HoverCard>
  );
}
