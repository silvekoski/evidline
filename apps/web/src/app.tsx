import { useEffect, useMemo, useState } from "react";
import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, RouterProvider } from "react-router";
import { toast } from "sonner";
import { sessionKey, workspaceSlug } from "@/api";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/layout/app-layout";
import { WorkspaceProvider } from "@/layout/workspace-context";
import { WorkspacePicker } from "@/layout/workspace-picker";
import { ClaimsScreen } from "@/screens/claims";
import { ConnectorsScreen } from "@/screens/connectors";
import { DataFlowScreen } from "@/screens/data-flow";
import { DiagnosisScreen } from "@/screens/diagnosis";
import { DriftScreen } from "@/screens/drift";
import { LoginScreen } from "@/screens/login";
import { LogScreen } from "@/screens/log";
import { NotificationsScreen } from "@/screens/notifications";
import { OpenQuestionsScreen } from "@/screens/open-questions";
import { ProfileScreen } from "@/screens/profile";
import { PublicUploadScreen } from "@/screens/public-upload";
import { QualityScreen } from "@/screens/quality";
import { RunScreen } from "@/screens/run";
import { RunsScreen } from "@/screens/runs";
import { SensorsScreen } from "@/screens/sensors";
import { SourceScreen } from "@/screens/source";
import { SourcesScreen } from "@/screens/sources";
import { SpecScreen } from "@/screens/spec";

const makeQueryClient = () =>
  new QueryClient({
    defaultOptions: { queries: { retry: 1, staleTime: 5_000 } },
    mutationCache: new MutationCache({ onError: (error) => toast.error("Request failed", { description: error.message }) }),
  });

const routes = [
  {
    path: "/",
    element: <AppLayout />,
    children: [
      { index: true, element: <RunScreen /> },
      { path: "runs", element: <RunsScreen /> },
      { path: "runs/:id/sensors", element: <SensorsScreen /> },
      { path: "runs/:id/quality", element: <QualityScreen /> },
      { path: "runs/:id/drift", element: <DriftScreen /> },
      { path: "runs/:id/diagnosis", element: <DiagnosisScreen /> },
      { path: "runs/:id/log", element: <LogScreen /> },
      { path: "runs/:id/data-flow", element: <DataFlowScreen /> },
      { path: "sources", element: <SourcesScreen /> },
      { path: "sources/:sourceId", element: <SourceScreen /> },
      { path: "claims", element: <ClaimsScreen /> },
      { path: "open-questions", element: <OpenQuestionsScreen /> },
      { path: "spec", element: <SpecScreen /> },
      { path: "connectors", element: <ConnectorsScreen /> },
      { path: "profile", element: <ProfileScreen /> },
      { path: "notifications", element: <NotificationsScreen /> },
    ],
  },
];

export const lastWorkspaceKey = "tpm.workspace";

function WorkspaceApp({ slug, onSwitch }: { slug: string; onSwitch: (slug: string) => void }) {
  const queryClient = useMemo(makeQueryClient, []);
  const router = useMemo(() => createBrowserRouter(routes, { basename: `/w/${slug}` }), [slug]);
  useEffect(() => {
    localStorage.setItem(lastWorkspaceKey, slug);
  }, [slug]);
  return (
    <QueryClientProvider client={queryClient}>
      <WorkspaceProvider slug={slug} onSwitch={onSwitch}>
        <TooltipProvider>
          <RouterProvider router={router} />
        </TooltipProvider>
      </WorkspaceProvider>
    </QueryClientProvider>
  );
}

export function App() {
  const [slug, setSlug] = useState(() => workspaceSlug());
  const [publicToken] = useState(() => /^\/upload\/([A-Za-z0-9_-]+)$/.exec(window.location.pathname)?.[1] ?? null);
  const [isLoginRoute] = useState(() => window.location.pathname === "/login");
  useEffect(() => {
    const onPop = () => setSlug(workspaceSlug());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const switchTo = (next: string) => {
    if (next === slug) return;
    const rest = slug ? window.location.pathname.slice(`/w/${slug}`.length) : "";
    window.history.pushState(null, "", `/w/${next}${rest}${window.location.search}`);
    setSlug(next);
  };

  const rootClient = useMemo(makeQueryClient, []);
  if (!isLoginRoute && !publicToken && !localStorage.getItem(sessionKey)) {
    window.location.replace("/login");
    return null;
  }
  return (
    <>
      {isLoginRoute ? (
        <LoginScreen />
      ) : publicToken ? (
        <QueryClientProvider client={rootClient}>
          <PublicUploadScreen token={publicToken} />
        </QueryClientProvider>
      ) : slug ? (
        <WorkspaceApp key={slug} slug={slug} onSwitch={switchTo} />
      ) : (
        <QueryClientProvider client={rootClient}>
          <WorkspacePicker onPick={(next) => { window.history.replaceState(null, "", `/w/${next}`); setSlug(next); }} />
        </QueryClientProvider>
      )}
      <Toaster theme="dark" position="bottom-right" />
    </>
  );
}
