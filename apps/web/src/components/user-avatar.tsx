import { cn } from "cn";
import { initials } from "@/lib/demo-user";

export function UserAvatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-medium text-primary-foreground",
        className,
      )}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}
