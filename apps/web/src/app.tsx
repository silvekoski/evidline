import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, RouterProvider } from "react-router";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/layout/app-layout";
import { DataFlowScreen } from "@/screens/data-flow";
import { DiagnosisScreen } from "@/screens/diagnosis";
import { DriftScreen } from "@/screens/drift";
import { LogScreen } from "@/screens/log";
import { QualityScreen } from "@/screens/quality";
import { RunScreen } from "@/screens/run";
import { RunsScreen } from "@/screens/runs";
import { SensorsScreen } from "@/screens/sensors";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 5_000 } },
  mutationCache: new MutationCache({
    onError: (error) => toast.error("Request failed", { description: error.message }),
  }),
});

const router = createBrowserRouter([
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
    ],
  },
]);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
      <Toaster theme="dark" position="bottom-right" />
    </QueryClientProvider>
  );
}
