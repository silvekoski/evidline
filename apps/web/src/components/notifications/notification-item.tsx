import { CircleCheckIcon, CircleXIcon, TriangleAlertIcon } from "lucide-react";
import { cn } from "cn";
import type { Notification, NotificationKind } from "@tpm/schemas";
import { Badge } from "@/components/ui/badge";
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { formatTime } from "@/lib/format";

export const kindLabel: Record<NotificationKind, string> = { "sensor-alert": "Sensor alert", "run-finished": "Run finished", "run-failed": "Run failed" };

const kindIcon: Record<NotificationKind, { icon: typeof TriangleAlertIcon; className: string }> = {
  "sensor-alert": { icon: TriangleAlertIcon, className: "text-foreground" },
  "run-finished": { icon: CircleCheckIcon, className: "text-muted-foreground" },
  "run-failed": { icon: CircleXIcon, className: "text-destructive" },
};

const previewLines = 3;

const emailText: Record<Notification["email"], string> = { off: "No email", sent: "Email sent", failed: "Email failed" };

export function NotificationItem({ notification, compact = false, onOpen }: { notification: Notification; compact?: boolean; onOpen: (n: Notification) => void }) {
  const { icon: Icon, className } = kindIcon[notification.kind];
  const unread = notification.readAt === null;
  const lines = notification.message.split("\n");
  const shown = compact ? lines.slice(0, previewLines) : lines;
  const hidden = lines.length - shown.length;
  return (
    <Item asChild variant={compact ? "default" : "outline"} size={compact ? "xs" : "default"} className={cn("text-left", unread && !compact && "bg-muted/40")}>
      <button type="button" onClick={() => onOpen(notification)} aria-label={`${unread ? "New: " : ""}${kindLabel[notification.kind]}. ${notification.title}. Open the run.`}>
        <ItemMedia variant="icon" className={className}>
          <Icon aria-hidden="true" />
        </ItemMedia>
        <ItemContent className="min-w-0 gap-1">
          <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <Badge variant="outline">{kindLabel[notification.kind]}</Badge>
            {unread && <Badge>New</Badge>}
            <time dateTime={notification.time}>{formatTime(notification.time)}</time>
          </span>
          <ItemTitle className={cn("min-w-0 truncate", unread && "font-medium")}>{notification.title}</ItemTitle>
          <ItemDescription className="line-clamp-none text-xs whitespace-pre-line">{shown.join("\n")}</ItemDescription>
          {hidden > 0 && <span className="text-xs text-muted-foreground">and {hidden} more</span>}
          <span className={cn("text-xs", notification.email === "failed" ? "text-destructive" : "text-muted-foreground")}>
            {emailText[notification.email]}
            {notification.emailError && `: ${notification.emailError}`}
            {!compact && notification.emailId && <span className="font-mono"> (resend {notification.emailId})</span>}
          </span>
        </ItemContent>
      </button>
    </Item>
  );
}
