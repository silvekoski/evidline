import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Rule } from "@tpm/schemas";
import { activateRule } from "@/api";

export function useActivateRule(onSuccess?: (rule: Rule) => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: activateRule,
    onSuccess: (rule) => {
      onSuccess?.(rule);
      toast.success("Rule activated", { description: rule.restated });
      void queryClient.invalidateQueries();
    },
  });
}
