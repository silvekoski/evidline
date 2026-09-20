import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { notificationScreen, type Notification } from "@tpm/schemas";
import { keys, listNotifications, markAllNotificationsRead, markNotificationRead } from "@/api";

export const notificationPath = (n: Notification): string | null => (n.runId === null ? null : `/runs/${n.runId}/${notificationScreen[n.kind]}`);

export const useNotifications = () => useQuery({ queryKey: keys.notifications, queryFn: listNotifications, refetchInterval: 15_000 });

export function useOpenNotification() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const read = useMutation({ mutationFn: markNotificationRead, onSuccess: () => client.invalidateQueries({ queryKey: keys.notifications }) });
  return (n: Notification): void => {
    if (n.readAt === null) read.mutate(n.id);
    const path = notificationPath(n);
    if (path) void navigate(path);
  };
}

export function useMarkAllRead() {
  const client = useQueryClient();
  return useMutation({ mutationFn: markAllNotificationsRead, onSuccess: () => client.invalidateQueries({ queryKey: keys.notifications }) });
}
