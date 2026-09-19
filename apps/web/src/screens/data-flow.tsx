import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export function DataFlowScreen() {
  return (
    <>
      <PageHeader title="Data flow" />
      <EmptyState title="In progress" description="This screen is not ready yet." />
    </>
  );
}
