import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export function DriftScreen() {
  return (
    <>
      <PageHeader title="Drift" />
      <EmptyState title="In progress" description="This screen is not ready yet." />
    </>
  );
}
