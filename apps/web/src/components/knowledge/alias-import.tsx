import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { importAliases } from "@/api";

export function useAliasImport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => importAliases(await file.text()),
    onSuccess: ({ added, unknown }) => {
      void queryClient.invalidateQueries({ queryKey: ["columns"] });
      toast.success(`${added} customer words added`, { description: unknown ? `${unknown} rows name a tag that is not in the catalog.` : undefined });
    },
  });
}
