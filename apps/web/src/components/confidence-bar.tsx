import { cn } from "cn";

export function ConfidenceBar({ value, className }: { value: number; className?: string }) {
  const filled = Math.round(Math.min(1, Math.max(0, value)) * 5);
  return (
    <span
      role="meter"
      aria-label="confidence"
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={value}
      aria-valuetext={value.toFixed(2)}
      className={cn("inline-flex items-center gap-2", className)}
    >
      <span className="flex gap-0.5" aria-hidden="true">
        {Array.from({ length: 5 }, (_, i) => (
          <span key={i} className={cn("h-2.5 w-1.5 rounded-xs border border-foreground", i < filled ? "bg-foreground" : "bg-transparent")} />
        ))}
      </span>
      <span className="font-mono text-xs tabular-nums">{value.toFixed(2)}</span>
    </span>
  );
}
