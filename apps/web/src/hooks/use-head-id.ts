import { useQuery } from "@tanstack/react-query";
import { getInferenceHead, keys } from "@/api";

const inferenceId = /^inf-[0-9a-f]{8}-\d{5}$/;

export function useHeadId(target: string, missing: boolean): string {
  const head = useQuery({
    queryKey: keys.inferenceHead(target),
    queryFn: () => getInferenceHead(target),
    enabled: missing && inferenceId.test(target),
    staleTime: Infinity,
  });
  return missing ? (head.data?.id ?? target) : target;
}
