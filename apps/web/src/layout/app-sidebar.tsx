import { useQuery } from "@tanstack/react-query";
import { NavLink, useLocation, useNavigate } from "react-router";
import { BookOpenIcon, CircleHelpIcon, FileTextIcon, FilesIcon, ListChecksIcon, LogOutIcon, PlayIcon, PlugIcon, UserIcon } from "lucide-react";
import { getSensors, keys, listRuns, sessionKey } from "@/api";
import { useActiveRunId } from "@/hooks/use-active-run-id";
import { useLens } from "@/hooks/use-lens";
import { useProfilePhoto } from "@/hooks/use-profile-photo";
import { UserAvatar } from "@/components/user-avatar";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarRail,
} from "@/components/ui/sidebar";
import { demoUser } from "@/lib/demo-user";
import { defaultRunId, screens, type ScreenSlug } from "./screens";
import { EvidlineLogo } from "@/components/evidline-logo";
import { EvidlineMark } from "@/components/evidline-mark";
import { WorkspaceSwitcher } from "./workspace-switcher";

const knowledgeScreens = [
  { path: "/sources", label: "Sources", icon: BookOpenIcon, tour: "tour-sources" },
  { path: "/claims", label: "Review claims", icon: ListChecksIcon, tour: undefined },
  { path: "/open-questions", label: "Open questions", icon: CircleHelpIcon, tour: undefined },
  { path: "/spec", label: "Data spec", icon: FileTextIcon, tour: undefined },
  { path: "/connectors", label: "Connectors", icon: PlugIcon, tour: "tour-connectors" },
];

export function currentScreen(pathname: string): ScreenSlug | null {
  const slug = pathname.split("/")[3];
  return screens.some((s) => s.slug === slug) ? (slug as ScreenSlug) : null;
}

function ScreenMenuItem({
  slug,
  label,
  icon: Icon,
  selectedRunId,
  pathname,
  badge,
}: {
  slug: ScreenSlug;
  label: string;
  icon: (typeof screens)[number]["icon"];
  selectedRunId: string;
  pathname: string;
  badge?: number;
}) {
  return (
    <SidebarMenuItem>
      {selectedRunId ? (
        <SidebarMenuButton asChild isActive={pathname === `/runs/${selectedRunId}/${slug}`} tooltip={label}>
          <NavLink to={`/runs/${selectedRunId}/${slug}`}>
            <Icon aria-hidden="true" />
            <span>{label}</span>
          </NavLink>
        </SidebarMenuButton>
      ) : (
        <SidebarMenuButton disabled aria-disabled="true" tooltip={label}>
          <Icon aria-hidden="true" />
          <span>{label}</span>
        </SidebarMenuButton>
      )}
      {badge ? <SidebarMenuBadge aria-label={`${badge} sensor${badge === 1 ? "" : "s"} disagree on name`}>{badge}</SidebarMenuBadge> : null}
    </SidebarMenuItem>
  );
}

export function AppSidebar() {
  const runId = useActiveRunId();
  const lens = useLens();
  const photoUrl = useProfilePhoto();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const runs = useQuery({ queryKey: keys.runs, queryFn: listRuns });
  const screen = currentScreen(pathname) ?? "sensors";
  const selectedRunId = runId ?? (runs.data?.some((r) => r.id === defaultRunId) ? defaultRunId : "");
  const sensors = useQuery({ queryKey: keys.sensors(selectedRunId), queryFn: () => getSensors(selectedRunId), enabled: selectedRunId !== "" });
  const nameDisagreements = sensors.data?.sensors.filter((s) => s.nameChecks.some((c) => c.agrees === false)).length ?? 0;

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex h-14 items-center px-2 group-data-[collapsible=icon]:justify-center">
          <EvidlineLogo replayKey={pathname} className="h-10 group-data-[collapsible=icon]:hidden" />
          <EvidlineMark replayKey={pathname} className="hidden size-6 group-data-[collapsible=icon]:inline-block" />
        </div>
        <WorkspaceSwitcher />
        <div className="flex flex-col gap-1 group-data-[collapsible=icon]:hidden">
          <Label htmlFor="run-selector" className="px-2 text-xs text-muted-foreground">
            Run
          </Label>
          {runs.isPending ? (
            <SidebarMenuSkeleton />
          ) : (
            <Select value={selectedRunId} onValueChange={(id) => navigate(`/runs/${id}/${screen}`)}>
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
                  <NavLink to="/" data-tour="tour-run">
                    <PlayIcon aria-hidden="true" />
                    <span>Run</span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={pathname === "/runs"} tooltip="Runs">
                  <NavLink to="/runs" data-tour="tour-runs">
                    <FilesIcon aria-hidden="true" />
                    <span>Runs</span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>{selectedRunId ? `Run ${selectedRunId}` : "Select a run"}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {screens
                .filter((screen) => screen.group === "run")
                .map(({ slug, label, icon }) => (
                  <ScreenMenuItem
                    key={slug}
                    slug={slug}
                    label={label(lens)}
                    icon={icon}
                    selectedRunId={selectedRunId}
                    pathname={pathname}
                    badge={slug === "sensors" ? nameDisagreements : undefined}
                  />
                ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel className="justify-between group-data-[collapsible=icon]:justify-center">
            System
            <Badge variant="outline" className="text-[10px] text-muted-foreground group-data-[collapsible=icon]:hidden">
              Advanced
            </Badge>
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {screens
                .filter((screen) => screen.group === "system")
                .map(({ slug, label, icon }) => (
                  <ScreenMenuItem key={slug} slug={slug} label={label(lens)} icon={icon} selectedRunId={selectedRunId} pathname={pathname} />
                ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Knowledge</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {knowledgeScreens.map(({ path, label, icon: Icon, tour }) => (
                <SidebarMenuItem key={path}>
                  <SidebarMenuButton asChild isActive={pathname === path || pathname.startsWith(`${path}/`)} tooltip={label}>
                    <NavLink to={path} data-tour={tour}>
                      <Icon aria-hidden="true" />
                      <span>{label}</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size="lg" tooltip={demoUser.name}>
                  <UserAvatar name={demoUser.name} photoUrl={photoUrl} />
                  <span className="flex flex-col items-start truncate group-data-[collapsible=icon]:hidden">
                    <span className="truncate text-sm">{demoUser.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{demoUser.email}</span>
                  </span>
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top">
                <DropdownMenuItem asChild>
                  <NavLink to="/profile">
                    <UserIcon aria-hidden="true" />
                    Profile
                  </NavLink>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => { localStorage.removeItem(sessionKey); window.location.assign("/login"); }}>
                  <LogOutIcon aria-hidden="true" />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
