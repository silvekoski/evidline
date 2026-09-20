import { z } from "zod";

export const NotificationKind = z.enum(["sensor-alert", "run-finished", "run-failed"]);
export type NotificationKind = z.infer<typeof NotificationKind>;
export const notificationKinds = NotificationKind.options;

export const EmailStatus = z.enum(["off", "sent", "failed"]);
export type EmailStatus = z.infer<typeof EmailStatus>;

export const Notification = z.object({
  id: z.string(),
  time: z.string(),
  kind: NotificationKind,
  title: z.string(),
  message: z.string(),
  runId: z.string().nullable(),
  readAt: z.string().nullable(),
  email: EmailStatus,
  emailError: z.string().nullable(),
});
export type Notification = z.infer<typeof Notification>;
export const NotificationList = z.array(Notification);

export const NotificationSettings = z.object({
  email: z.record(NotificationKind, z.boolean()),
  emailConfigured: z.boolean(),
  recipients: z.array(z.string()),
});
export type NotificationSettings = z.infer<typeof NotificationSettings>;

export const NotificationSettingsBody = z.object({ email: z.partialRecord(NotificationKind, z.boolean()) });
export type NotificationSettingsBody = z.infer<typeof NotificationSettingsBody>;

export const NotificationTestResult = z.object({ email: EmailStatus, emailError: z.string().nullable() });
export type NotificationTestResult = z.infer<typeof NotificationTestResult>;

export const notificationScreen: Record<NotificationKind, "quality" | "sensors" | "log"> = { "sensor-alert": "quality", "run-finished": "sensors", "run-failed": "log" };
