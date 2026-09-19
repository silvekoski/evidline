import { useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { TagsIcon } from "lucide-react";
import { toast } from "sonner";
import { importAliases } from "@/api";
import { Button } from "@/components/ui/button";

export function AliasImportButton() {
  const input = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const run = useMutation({
    mutationFn: async (file: File) => importAliases(await file.text()),
    onSuccess: ({ added, unknown }) => {
      void queryClient.invalidateQueries({ queryKey: ["columns"] });
      toast.success(`${added} customer words added`, { description: unknown ? `${unknown} rows name a tag that is not in the catalog.` : undefined });
    },
  });
  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".csv,text/csv"
        className="sr-only"
        aria-label="Import a tag list"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) run.mutate(file);
          e.target.value = "";
        }}
      />
      <Button variant="outline" size="sm" onClick={() => input.current?.click()} disabled={run.isPending} title="A CSV with a tag column and a description column">
        <TagsIcon aria-hidden="true" /> Import tag list
      </Button>
    </>
  );
}
