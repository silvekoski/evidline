import { createContext, useContext, type ReactNode } from "react";

export type WorkspaceState = { slug: string; switchTo: (slug: string) => void };

const WorkspaceContext = createContext<WorkspaceState | null>(null);

export function WorkspaceProvider({ slug, onSwitch, children }: { slug: string; onSwitch: (slug: string) => void; children: ReactNode }) {
  return <WorkspaceContext.Provider value={{ slug, switchTo: onSwitch }}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceState {
  const state = useContext(WorkspaceContext);
  if (!state) throw new Error("useWorkspace needs a WorkspaceProvider");
  return state;
}
