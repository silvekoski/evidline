import type { ComponentType, ReactNode } from "react";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

export function EmptyState({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon?: ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" }>;
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <Empty className="flex-none border py-12">
      <EmptyHeader>
        {Icon && (
          <EmptyMedia variant="icon">
            <Icon aria-hidden="true" />
          </EmptyMedia>
        )}
        <EmptyTitle>{title}</EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
      {children && <EmptyContent>{children}</EmptyContent>}
    </Empty>
  );
}
