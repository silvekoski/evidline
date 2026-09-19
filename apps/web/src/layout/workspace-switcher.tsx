import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, ChevronsUpDownIcon, PlusIcon } from "lucide-react";
import type { Workspace } from "@tpm/schemas";
import { createWorkspace, keys, listWorkspaces } from "@/api";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useWorkspace } from "./workspace-context";

const slugify = (name: string) => name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

type DialogProps = { onCreated: (w: Workspace) => void; open?: boolean; onOpenChange?: (open: boolean) => void };

export function NewWorkspaceDialog({ onCreated, open: controlled, onOpenChange }: DialogProps) {
  const [own, setOwn] = useState(false);
  const open = controlled ?? own;
  const setOpen = onOpenChange ?? setOwn;
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [domains, setDomains] = useState("");
  const [retention, setRetention] = useState("");
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: () => createWorkspace({ name, slug: slug || slugify(name), domains: domains.split(/[\s,;]+/).filter(Boolean), retentionDays: retention ? Number(retention) : null }),
    onSuccess: (w) => {
      void queryClient.invalidateQueries({ queryKey: keys.workspaces });
      setOpen(false);
      onCreated(w);
    },
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {controlled === undefined && (
        <DialogTrigger asChild>
          <Button size="sm">
            <PlusIcon aria-hidden="true" /> New workspace
          </Button>
        </DialogTrigger>
      )}
      <DialogContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
          className="flex flex-col gap-4"
        >
          <DialogHeader>
            <DialogTitle>New workspace</DialogTitle>
            <DialogDescription>One workspace holds one customer: its runs, sources, claims, and data spec.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="ws-name">Name</Label>
            <Input id="ws-name" value={name} required onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="ws-slug">Slug</Label>
            <Input id="ws-slug" value={slug} placeholder={slugify(name) || "acme"} pattern="[a-z0-9][a-z0-9-]{0,38}[a-z0-9]" onChange={(e) => setSlug(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="ws-domains">Customer email domains</Label>
            <Input id="ws-domains" value={domains} placeholder="acme.example, plant.acme.example" onChange={(e) => setDomains(e.target.value)} />
            <p className="text-xs text-muted-foreground">Emails and Teams calls with these domains land in this workspace.</p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="ws-retention">Retention (days)</Label>
            <Input id="ws-retention" type="number" min={1} max={3650} value={retention} placeholder="no limit" onChange={(e) => setRetention(e.target.value)} />
            <p className="text-xs text-muted-foreground">A daily job removes each source older than this, with its chunks, vectors, and claims.</p>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={create.isPending || name.trim() === ""}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function WorkspaceSwitcher() {
  const { slug, switchTo } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const workspaces = useQuery({ queryKey: keys.workspaces, queryFn: listWorkspaces });
  const current = workspaces.data?.find((w) => w.slug === slug);
  return (
    <>
    <NewWorkspaceDialog open={creating} onOpenChange={setCreating} onCreated={(w) => switchTo(w.slug)} />
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" role="combobox" aria-expanded={open} aria-label="Workspace" className="w-full justify-between group-data-[collapsible=icon]:hidden">
          <span className="truncate">{current?.name ?? slug}</span>
          <ChevronsUpDownIcon aria-hidden="true" className="opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder="Find a workspace" />
          <CommandList>
            <CommandEmpty>No workspace.</CommandEmpty>
            <CommandGroup heading="Workspaces">
              {(workspaces.data ?? []).map((w) => (
                <CommandItem
                  key={w.slug}
                  value={`${w.name} ${w.slug}`}
                  onSelect={() => {
                    setOpen(false);
                    switchTo(w.slug);
                  }}
                >
                  <CheckIcon aria-hidden="true" className={w.slug === slug ? "opacity-100" : "opacity-0"} />
                  <span className="truncate">{w.name}</span>
                  <span className="ml-auto font-mono text-xs text-muted-foreground">{w.slug}</span>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup>
              <CommandItem
                value="new workspace"
                onSelect={() => {
                  setOpen(false);
                  setCreating(true);
                }}
              >
                <PlusIcon aria-hidden="true" /> New workspace
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
    </>
  );
}
