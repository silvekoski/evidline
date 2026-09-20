import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { ActivityIcon, ExternalLinkIcon, EyeIcon, MoreVerticalIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import type { Source } from "@tpm/schemas";
import { deleteSource, reprocessSource, sourceBlobUrl } from "@/api";
import { ConfirmAction } from "@/components/confirm-action";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export const externalName = (source: Source) => (source.kind === "slack_thread" ? "Slack" : "Teams");

export function SourceMenu({ source, showOpen = true, onDeleted }: { source: Source; showOpen?: boolean; onDeleted?: () => void }) {
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["sources"] });
  const reprocess = useMutation({
    mutationFn: () => reprocessSource(source.id),
    onSuccess: () => {
      refresh();
      toast.success("Queued", { description: `${source.title} goes through the pipeline again.` });
    },
  });
  const remove = useMutation({
    mutationFn: () => deleteSource(source.id),
    onSuccess: () => {
      refresh();
      toast.success("Source deleted", { description: source.title });
      onDeleted?.();
    },
  });
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${source.title}`} onClick={(e) => e.stopPropagation()}>
            <MoreVerticalIcon aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
          {showOpen && (
            <DropdownMenuItem asChild>
              <Link to={`/sources/${source.id}`}>
                <EyeIcon aria-hidden="true" /> Open
              </Link>
            </DropdownMenuItem>
          )}
          {source.blobPath && (
            <DropdownMenuItem asChild>
              <a href={sourceBlobUrl(source.id)} target="_blank" rel="noreferrer">
                <ExternalLinkIcon aria-hidden="true" /> Original file
              </a>
            </DropdownMenuItem>
          )}
          {source.externalUrl && (
            <DropdownMenuItem asChild>
              <a href={source.externalUrl} target="_blank" rel="noreferrer">
                <ExternalLinkIcon aria-hidden="true" /> Open in {externalName(source)}
              </a>
            </DropdownMenuItem>
          )}
          {source.runId && (
            <DropdownMenuItem asChild>
              <Link to={`/runs/${source.runId}/sensors`}>
                <ActivityIcon aria-hidden="true" /> Run {source.runId}
              </Link>
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => reprocess.mutate()} disabled={reprocess.isPending}>
            <RefreshCwIcon aria-hidden="true" /> Process again
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setConfirm(true)} disabled={remove.isPending}>
            <Trash2Icon aria-hidden="true" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmAction
        open={confirm}
        onOpenChange={setConfirm}
        title={`Delete ${source.title}?`}
        description="The source goes away with its segments, chunks, vectors, and claims. A claim that the data spec uses goes away too."
        action="Delete source"
        onConfirm={() => remove.mutate()}
      />
    </>
  );
}
