import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export function LogScreen() {
  return (
    <>
      <PageHeader title="Log" />
      <EmptyState title="In progress" description="This screen is not ready yet." />
    </>
  );
}
