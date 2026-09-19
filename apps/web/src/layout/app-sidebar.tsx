import { useQuery } from "@tanstack/react-query";
import { NavLink, useLocation, useNavigate } from "react-router";
import { FilesIcon, PlayIcon } from "lucide-react";
import { keys, listRuns } from "@/api";
import { useActiveRunId } from "@/hooks/use-active-run-id";
import { useLens } from "@/hooks/use-lens";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarRail,
} from "@/components/ui/sidebar";
import { screens, type ScreenSlug } from "./screens";

export function currentScreen(pathname: string): ScreenSlug | null {
  const slug = pathname.split("/")[3];
  return screens.some((s) => s.slug === slug) ? (slug as ScreenSlug) : null;
}

export function AppSidebar() {
  const runId = useActiveRunId();
  const lens = useLens();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const runs = useQuery({ queryKey: keys.runs, queryFn: listRuns });
  const screen = currentScreen(pathname) ?? "sensors";

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex h-8 items-center gap-2 px-2 font-medium group-data-[collapsible=icon]:justify-center">
          <span className="font-mono text-xs" aria-hidden="true">
            TPM
          </span>
          <span className="truncate group-data-[collapsible=icon]:hidden">Process Monitor</span>
        </div>
        <div className="flex flex-col gap-1 group-data-[collapsible=icon]:hidden">
          <Label htmlFor="run-selector" className="px-2 text-xs text-muted-foreground">
            Run
          </Label>
          {runs.isPending ? (
            <SidebarMenuSkeleton />
          ) : (
            <Select value={runId ?? ""} onValueChange={(id) => navigate(`/runs/${id}/${screen}`)}>
              <SelectTrigger id="run-selector" size="sm" className="w-full">
                <SelectValue placeholder="Select a run" />
              </SelectTrigger>
              <SelectContent>
                {(runs.data ?? []).map((run) => (
                  <SelectItem key={run.id} value={run.id}>
                    <span className="truncate">{run.name}</span>
                    <span className="font-mono text-xs text-muted-foreground">{run.id}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={pathname === "/"} tooltip="Run">
                  <NavLink to="/">
                    <PlayIcon aria-hidden="true" />
                    <span>Run</span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={pathname === "/runs"} tooltip="Runs">
                  <NavLink to="/runs">
                    <FilesIcon aria-hidden="true" />
                    <span>Runs</span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>{runId ? `Run ${runId}` : "Select a run"}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {screens.map(({ slug, label, icon: Icon }) => (
                <SidebarMenuItem key={slug}>
                  {runId ? (
                    <SidebarMenuButton asChild isActive={pathname === `/runs/${runId}/${slug}`} tooltip={label(lens)}>
                      <NavLink to={`/runs/${runId}/${slug}`}>
                        <Icon aria-hidden="true" />
                        <span>{label(lens)}</span>
                      </NavLink>
                    </SidebarMenuButton>
                  ) : (
                    <SidebarMenuButton disabled aria-disabled="true" tooltip={label(lens)}>
                      <Icon aria-hidden="true" />
                      <span>{label(lens)}</span>
                    </SidebarMenuButton>
                  )}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
