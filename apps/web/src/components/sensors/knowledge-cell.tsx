import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { CheckIcon, CircleDashedIcon, CircleHelpIcon } from "lucide-react";
import { keys, listColumns } from "@/api";

export const LOW_CONFIDENCE = 0.5;

export function KnowledgeCell({ alias, sourceName }: { alias: string; sourceName: string }) {
  const navigate = useNavigate();
  const catalog = useQuery({ queryKey: keys.columns, queryFn: listColumns, staleTime: 30_000 });
  const column = catalog.data?.find((c) => c.name === sourceName);
  if (!column) return <span className="text-xs text-muted-foreground">{catalog.isPending ? "…" : "none"}</span>;
  const open = column.claims - column.confirmedClaims;
  const Icon = column.confirmedClaims > 0 ? CheckIcon : open > 0 ? CircleDashedIcon : column.confidence < LOW_CONFIDENCE ? CircleHelpIcon : null;
  const text = column.confirmedClaims > 0 ? `${column.confirmedClaims} confirmed${open > 0 ? `, ${open} open` : ""}` : open > 0 ? `${open} to review` : column.confidence < LOW_CONFIDENCE ? "open question" : "none";
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 rounded-sm text-xs underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      aria-label={`Knowledge of ${alias}: ${text}`}
      onClick={(event) => {
        event.stopPropagation();
        navigate({ hash: `#${alias}`, search: "?tab=knowledge" }, { replace: true });
      }}
    >
      {Icon && <Icon aria-hidden="true" className="size-3.5" />}
      {text}
    </button>
  );
}
