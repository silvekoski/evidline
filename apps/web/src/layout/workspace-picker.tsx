import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { keys, listWorkspaces } from "@/api";
import { EmptyState } from "@/components/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { NewWorkspaceDialog } from "./workspace-switcher";

const lastWorkspaceKey = "tpm.workspace";

export function WorkspacePicker({ onPick }: { onPick: (slug: string) => void }) {
  const workspaces = useQuery({ queryKey: keys.workspaces, queryFn: listWorkspaces });
  useEffect(() => {
    if (!workspaces.data?.length) return;
    const last = localStorage.getItem(lastWorkspaceKey);
    onPick(workspaces.data.some((w) => w.slug === last) ? last! : workspaces.data[0]!.slug);
  }, [workspaces.data, onPick]);
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      {workspaces.isPending ? (
        <Skeleton className="h-24 w-72" />
      ) : workspaces.isError ? (
        <EmptyState title="Server not reachable" description={workspaces.error.message} />
      ) : workspaces.data.length === 0 ? (
        <EmptyState title="No workspace" description="Make the first workspace. One workspace holds one customer.">
          <NewWorkspaceDialog onCreated={(w) => onPick(w.slug)} />
        </EmptyState>
      ) : null}
    </main>
  );
}
