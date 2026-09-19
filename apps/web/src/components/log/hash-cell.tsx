import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { shortHash } from "@/lib/format";

export function HashCell({ hash }: { hash: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="rounded-sm font-mono text-xs underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          aria-label={`Hash ${hash}. Click to copy.`}
          onClick={() => {
            if (!navigator.clipboard) return;
            void navigator.clipboard.writeText(hash).then(() => toast.success("Hash copied", { description: shortHash(hash) }));
          }}
        >
          {shortHash(hash)}
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-none font-mono">{hash}</TooltipContent>
    </Tooltip>
  );
}
