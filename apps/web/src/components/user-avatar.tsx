import { cn } from "cn";
import { initials } from "@/lib/demo-user";

export function UserAvatar({ name, photoUrl, className }: { name: string; photoUrl?: string | null; className?: string }) {
  const shapeClass = cn("size-8 shrink-0 rounded-full", className);
  if (photoUrl) {
    return <img src={photoUrl} alt="" className={cn(shapeClass, "object-cover")} />;
  }
  return (
    <span
      className={cn("flex items-center justify-center bg-primary text-sm font-medium text-primary-foreground", shapeClass)}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}
