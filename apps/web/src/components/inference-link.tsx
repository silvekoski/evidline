import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { getInferenceHead, keys } from "@/api";
import { screenForStage, screenPath, type ScreenSlug } from "@/layout/screens";

export function InferenceLink({ runId, id, screen, className }: { runId: string | null; id: string | null; screen?: ScreenSlug; className?: string }) {
  const head = useQuery({
    queryKey: keys.inferenceHead(id ?? ""),
    queryFn: () => getInferenceHead(id ?? ""),
    enabled: id !== null && screen === undefined,
    staleTime: Infinity,
  });
  if (id === null) return <span className="text-muted-foreground">none</span>;
  const slug = screen ?? (head.data ? screenForStage[head.data.stage] : null);
  if (runId === null || slug === null) return <span className={className}>{id}</span>;
  return (
    <Link to={screenPath(runId, slug, head.data?.id ?? id)} className={className} onClick={(event) => event.stopPropagation()}>
      {id}
    </Link>
  );
}
