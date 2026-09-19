import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import type { EgressRecord, Purpose } from "@tpm/schemas";
import { getInference, keys } from "@/api";
import { screenForStage, screenPath, type ScreenSlug } from "@/layout/screens";

const purposeScreen: Partial<Record<Purpose, ScreenSlug>> = {
  name_role: "sensors",
  compile_rule: "quality",
  explain_diagnosis: "diagnosis",
};

export function InferenceLink({ record, className }: { record: EgressRecord; className?: string }) {
  const id = record.inferenceId ?? "";
  const known = purposeScreen[record.purpose];
  const inference = useQuery({
    queryKey: keys.inference(id),
    queryFn: () => getInference(id),
    enabled: id !== "" && known === undefined,
    staleTime: Infinity,
  });
  if (id === "") return <span className="text-muted-foreground">none</span>;
  const screen = known ?? (inference.data ? screenForStage[inference.data.stage] : null);
  if (record.runId === null || screen === null) return <span className={className}>{id}</span>;
  return (
    <Link to={screenPath(record.runId, screen, id)} className={className} onClick={(event) => event.stopPropagation()}>
      {id}
    </Link>
  );
}
