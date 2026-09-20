import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellOffIcon, CheckCheckIcon, SendIcon } from "lucide-react";
import { toast } from "sonner";
import { notificationKinds, type NotificationKind } from "@tpm/schemas";
import { getNotificationSettings, keys, sendTestNotification, setNotificationSettings } from "@/api";
import { EmptyState } from "@/components/empty-state";
import { kindLabel, NotificationItem } from "@/components/notifications/notification-item";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Toggle } from "@/components/ui/toggle";
import { useMarkAllRead, useNotifications, useOpenNotification } from "@/hooks/use-notifications";

const kindHint: Record<NotificationKind, string> = {
  "sensor-alert": "A run flags a sensor with a failed health check or a drift.",
  "run-finished": "A run completes all stages.",
  "run-failed": "A run stops with an error.",
};

function EmailSettings() {
  const client = useQueryClient();
  const settings = useQuery({ queryKey: keys.notificationSettings, queryFn: getNotificationSettings });
  const save = useMutation({ mutationFn: setNotificationSettings, onSuccess: (data) => client.setQueryData(keys.notificationSettings, data) });
  const test = useMutation({
    mutationFn: sendTestNotification,
    onSuccess: (result) => (result.email === "sent" ? toast.success("Test email sent.") : toast.error("Test email failed", { description: result.emailError ?? undefined })),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Email</CardTitle>
        <CardDescription>
          {settings.data?.emailConfigured
            ? `Each email goes to ${settings.data.recipients.join(", ")}. Set ALERT_TO on the server to change the list.`
            : "Set RESEND_API_KEY, ALERT_FROM and ALERT_TO on the server to turn email on."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {settings.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : settings.isError ? (
          <p className="text-sm text-destructive">{settings.error.message}</p>
        ) : (
          notificationKinds.map((kind) => (
            <div key={kind} className="flex items-center justify-between gap-4">
              <Label htmlFor={`email-${kind}`} className="flex flex-col items-start gap-0.5 font-normal">
                {kindLabel[kind]}
                <span className="text-xs text-muted-foreground">{kindHint[kind]}</span>
              </Label>
              <Switch id={`email-${kind}`} checked={settings.data.email[kind]} disabled={save.isPending} onCheckedChange={(checked) => save.mutate({ email: { [kind]: checked } })} />
            </div>
          ))
        )}
        <Button type="button" variant="outline" size="sm" className="self-start" disabled={!settings.data?.emailConfigured || test.isPending} onClick={() => test.mutate()}>
          <SendIcon aria-hidden="true" /> Send a test email
        </Button>
      </CardContent>
    </Card>
  );
}

export function NotificationsScreen() {
  const notifications = useNotifications();
  const open = useOpenNotification();
  const markAll = useMarkAllRead();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const list = (notifications.data ?? []).filter((n) => !unreadOnly || n.readAt === null);
  const unread = (notifications.data ?? []).filter((n) => n.readAt === null).length;

  return (
    <>
      <PageHeader title="Notifications" description="Each run that finishes, fails, or flags a sensor leaves a notification here. Open one to go to the run.">
        <Toggle size="sm" variant="outline" pressed={unreadOnly} onPressedChange={setUnreadOnly} aria-label="Show unread only">
          Unread only{unread > 0 && ` (${unread})`}
        </Toggle>
        <Button size="sm" variant="outline" disabled={unread === 0 || markAll.isPending} onClick={() => markAll.mutate()}>
          <CheckCheckIcon aria-hidden="true" /> Mark all read
        </Button>
      </PageHeader>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section aria-label="Notification list" className="flex flex-col gap-2">
          {notifications.isPending ? (
            <Skeleton className="h-40 w-full" />
          ) : notifications.isError ? (
            <EmptyState title="Notifications not available" description={notifications.error.message} />
          ) : list.length === 0 ? (
            <EmptyState icon={BellOffIcon} title={unreadOnly ? "No unread notification" : "No notification yet"} description={unreadOnly ? "Every notification is read." : "Start a run. The result shows here."} />
          ) : (
            list.map((n) => <NotificationItem key={n.id} notification={n} onOpen={open} />)
          )}
        </section>
        <EmailSettings />
      </div>
    </>
  );
}
