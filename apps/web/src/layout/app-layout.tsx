import { Outlet } from "react-router";
import { SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { EvidenceSheet } from "@/components/evidence-sheet";
import { AppBreadcrumb } from "./app-breadcrumb";
import { AppSidebar } from "./app-sidebar";
import { ColorPaletteSwitch } from "./color-palette-switch";
import { CommandPalette, useCommandPalette } from "./command-palette";

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

export function AppLayout() {
  const palette = useCommandPalette();
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-12 shrink-0 items-center gap-2 border-b bg-background px-4">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-4" />
          <AppBreadcrumb />
          <Button variant="outline" size="sm" className="ml-auto text-muted-foreground" onClick={() => palette.setOpen(true)}>
            <SearchIcon aria-hidden="true" />
            <span>Jump to</span>
            <Kbd>{isMac ? "⌘" : "Ctrl"} K</Kbd>
          </Button>
          <ColorPaletteSwitch />
        </header>
        <div className="flex flex-1 flex-col p-4">
          <Outlet />
        </div>
      </SidebarInset>
      <EvidenceSheet />
      <CommandPalette open={palette.open} onOpenChange={palette.setOpen} />
    </SidebarProvider>
  );
}
