import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { BellIcon, CheckCheckIcon } from "lucide-react";
import { toast } from "sonner";
import { NotificationItem } from "@/components/notifications/notification-item";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { notificationPath, useMarkAllRead, useNotifications, useOpenNotification } from "@/hooks/use-notifications";

const previewCount = 6;

export function NotificationBell() {
  const notifications = useNotifications();
  const open = useOpenNotification();
  const markAll = useMarkAllRead();
  const [popoverOpen, setPopoverOpen] = useState(false);
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    const list = notifications.data;
    if (!list) return;
    if (seen.current === null) {
      seen.current = new Set(list.map((n) => n.id));
      return;
    }
    for (const n of list) {
      if (seen.current.has(n.id)) continue;
      seen.current.add(n.id);
      if (n.readAt !== null) continue;
      const path = notificationPath(n);
      toast(n.title, { description: n.message.split("\n")[0], ...(path ? { action: { label: "Open", onClick: () => open(n) } } : {}) });
    }
  }, [notifications.data, open]);

  const unread = (notifications.data ?? []).filter((n) => n.readAt === null).length;
  const label = unread === 0 ? "Notifications" : `Notifications, ${unread} unread`;

  return (
    <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label} className="relative overflow-visible">
          <BellIcon aria-hidden="true" />
          {unread > 0 && (
            <span aria-hidden="true" className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 gap-0 p-0">
        <PopoverHeader className="flex flex-row items-start justify-between gap-2 border-b px-3 py-2">
          <div className="flex flex-col gap-0.5">
            <PopoverTitle>Notification center</PopoverTitle>
            <PopoverDescription>{unread === 0 ? "Nothing new. Open a notification to go to its run." : `${unread} new. Open a notification to go to its run.`}</PopoverDescription>
          </div>
          <Button variant="ghost" size="xs" disabled={unread === 0 || markAll.isPending} onClick={() => markAll.mutate()}>
            <CheckCheckIcon aria-hidden="true" /> Mark all read
          </Button>
        </PopoverHeader>
        <div className="max-h-96 overflow-y-auto p-1">
          {notifications.isPending ? (
            <p className="p-3 text-sm text-muted-foreground">Loading</p>
          ) : notifications.isError ? (
            <p className="p-3 text-sm text-destructive">{notifications.error.message}</p>
          ) : notifications.data.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">No notification yet. A run that finishes, fails, or flags a sensor shows here.</p>
          ) : (
            notifications.data.slice(0, previewCount).map((n) => (
              <NotificationItem
                key={n.id}
                notification={n}
                compact
                onOpen={(item) => {
                  setPopoverOpen(false);
                  open(item);
                }}
              />
            ))
          )}
        </div>
        <div className="border-t p-1">
          <Button asChild variant="ghost" size="sm" className="w-full">
            <Link to="/notifications" onClick={() => setPopoverOpen(false)}>
              Open the notification center{notifications.data && notifications.data.length > previewCount && ` (${notifications.data.length} total)`}
            </Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
