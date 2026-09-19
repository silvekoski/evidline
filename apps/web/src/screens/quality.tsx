import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export function QualityScreen() {
  return (
    <>
      <PageHeader title="Quality" />
      <EmptyState title="In progress" description="This screen is not ready yet." />
    </>
  );
}
