import { Link, useLocation } from "react-router";
import { useActiveRunId } from "@/hooks/use-active-run-id";
import { useLens } from "@/hooks/use-lens";
import { useRun } from "@/hooks/use-run";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { currentScreen } from "./app-sidebar";
import { screens } from "./screens";

const pageTitles: Record<string, string> = { runs: "Runs", sources: "Sources", "open-questions": "Open questions", spec: "Data spec", connectors: "Connectors" };

export function AppBreadcrumb() {
  const { pathname } = useLocation();
  const runId = useActiveRunId();
  const run = useRun();
  const lens = useLens();
  const screen = screens.find((s) => s.slug === currentScreen(pathname));

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {runId && screen ? (
          <>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link to="/runs">Runs</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link to={`/runs/${runId}/sensors`}>{run.data?.name ?? runId}</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{screen.label(lens)}</BreadcrumbPage>
            </BreadcrumbItem>
          </>
        ) : (
          <BreadcrumbItem>
            <BreadcrumbPage>{pageTitles[pathname.split("/")[1] ?? ""] ?? "Run"}</BreadcrumbPage>
          </BreadcrumbItem>
        )}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
