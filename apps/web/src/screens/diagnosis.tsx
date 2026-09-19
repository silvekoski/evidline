import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export function DiagnosisScreen() {
  return (
    <>
      <PageHeader title="Diagnosis" />
      <EmptyState title="In progress" description="This screen is not ready yet." />
    </>
  );
}
