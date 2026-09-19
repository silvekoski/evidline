import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { useLens } from "@/hooks/use-lens";
import { capitalize } from "@/lib/format";

export function SensorsScreen() {
  const lens = useLens();
  return (
    <>
      <PageHeader title={capitalize(lens.sensors)} />
      <EmptyState title="In progress" description="This screen is not ready yet." />
    </>
  );
}
