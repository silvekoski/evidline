import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { keys, listWorkspaces, patchWorkspace } from "@/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useWorkspace } from "@/layout/workspace-context";

export function WorkspaceSettings() {
  const { slug } = useWorkspace();
  const queryClient = useQueryClient();
  const workspaces = useQuery({ queryKey: keys.workspaces, queryFn: listWorkspaces });
  const current = workspaces.data?.find((w) => w.slug === slug);
  const [domains, setDomains] = useState("");
  const [retention, setRetention] = useState("");
  useEffect(() => {
    if (!current) return;
    setDomains(current.domains.join(", "));
    setRetention(current.retentionDays === null ? "" : String(current.retentionDays));
  }, [current]);
  const save = useMutation({
    mutationFn: () => patchWorkspace(slug, { domains: domains.split(/[\s,;]+/).filter(Boolean), retentionDays: retention ? Number(retention) : null }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.workspaces });
      toast.success("Workspace saved");
    },
  });
  if (!current) return null;
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Workspace {current.name}</CardTitle>
        <CardDescription>Routing domains and the retention period of this workspace.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3 md:grid-cols-[1fr_10rem_auto] md:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="grid gap-1">
            <Label htmlFor="ws-domains-edit">Customer email domains</Label>
            <Input id="ws-domains-edit" value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="acme.example" />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="ws-retention-edit">Retention (days)</Label>
            <Input id="ws-retention-edit" type="number" min={1} max={3650} value={retention} onChange={(e) => setRetention(e.target.value)} placeholder="no limit" />
          </div>
          <Button type="submit" size="sm" disabled={save.isPending}>
            Save
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
