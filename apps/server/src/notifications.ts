import { hostname } from "node:os";
import { fetchTransport, sendResendAlert, type Alert } from "@tpm/connectors";
import {
  NotificationSettingsBody,
  notificationScreen,
  type EmailStatus,
  type Inference,
  type Notification,
  type NotificationKind,
  type NotificationSettings,
  type Run,
} from "@tpm/schemas";
import type { AppContext } from "./context";
import type { Db } from "./db";
import { brandedEmail, type EmailDebug } from "./email-template";
import { newNotificationId } from "./ids";

type Notifier = Pick<AppContext, "db" | "slug" | "log">;
export type NotificationDraft = Pick<Notification, "kind" | "title" | "message" | "runId">;
export type EmailResult = { email: EmailStatus; emailId: string | null; emailError: string | null };

const settingsKey = "notifications";
const defaultEmail: Record<NotificationKind, boolean> = { "sensor-alert": true, "run-finished": false, "run-failed": true };

function emailConfig(): { apiKey: string; from: string; to: string[] } | null {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.ALERT_FROM;
  const to = (process.env.ALERT_TO ?? "").split(",").map((address) => address.trim()).filter(Boolean);
  return apiKey && from && to.length > 0 ? { apiKey, from, to } : null;
}

export function getNotificationSettings(db: Db): NotificationSettings {
  const stored = NotificationSettingsBody.safeParse(JSON.parse(db.settings.get(settingsKey) ?? "null")).data;
  const config = emailConfig();
  return { email: { ...defaultEmail, ...stored?.email }, emailConfigured: config !== null, recipients: config?.to ?? [] };
}

export function setNotificationSettings(db: Db, body: NotificationSettingsBody): NotificationSettings {
  db.settings.set(settingsKey, JSON.stringify({ email: { ...getNotificationSettings(db).email, ...body.email } }));
  return getNotificationSettings(db);
}

export async function sendEmail(alert: Alert, ref: string, log: (line: string) => void): Promise<EmailResult> {
  const config = emailConfig();
  if (!config) return { email: "off", emailId: null, emailError: "RESEND_API_KEY, ALERT_FROM or ALERT_TO is not set" };
  const started = performance.now();
  const done = (result: EmailResult): EmailResult => {
    const ms = Math.round(performance.now() - started);
    const detail = result.email === "sent" ? `resend=${result.emailId ?? "?"}` : `error=${JSON.stringify(result.emailError)}`;
    log(`email ${result.email} ref=${ref} from=${config.from} to=${config.to.join(",")} subject=${JSON.stringify(alert.title)} bytes=${alert.html?.length ?? alert.message.length} ${detail} ${ms} ms`);
    return result;
  };
  try {
    const result = await sendResendAlert(fetchTransport, config, alert);
    return done(result.ok ? { email: "sent", emailId: result.id, emailError: null } : { email: "failed", emailId: null, emailError: result.error });
  } catch (e) {
    return done({ email: "failed", emailId: null, emailError: e instanceof Error ? e.message : String(e) });
  }
}

export const emailDebug = (ctx: Pick<AppContext, "slug">, fields: EmailDebug): EmailDebug => ({
  ...fields,
  workspace: ctx.slug,
  host: hostname(),
  server: process.env.APP_URL ?? "APP_URL not set",
  "sent at": new Date().toISOString(),
});

function runLink(ctx: Notifier, draft: NotificationDraft): { label: string; url: string } | null {
  const base = process.env.APP_URL;
  if (!base || draft.runId === null) return null;
  return { label: "Open the run", url: `${base.replace(/\/$/, "")}/w/${ctx.slug}/runs/${draft.runId}/${notificationScreen[draft.kind]}` };
}

export async function notify(ctx: Notifier, draft: NotificationDraft): Promise<Notification> {
  const settings = getNotificationSettings(ctx.db);
  let notification: Notification = { ...draft, id: newNotificationId(), time: new Date().toISOString(), readAt: null, email: "off", emailId: null, emailError: null };
  ctx.db.notifications.save(notification);
  if (settings.emailConfigured && settings.email[draft.kind]) {
    const debug = emailDebug(ctx, { notification: notification.id, kind: draft.kind, run: draft.runId ?? "none" });
    notification = { ...notification, ...(await sendEmail(brandedEmail(draft.title, draft.message, runLink(ctx, draft), debug), notification.id, ctx.log)) };
    ctx.db.notifications.save(notification);
  } else {
    ctx.log(`email off ref=${notification.id} kind=${draft.kind} configured=${settings.emailConfigured} enabled=${settings.email[draft.kind]}`);
  }
  return notification;
}

export function sensorAlert(run: Run, inferences: Inference[]): NotificationDraft | null {
  const lines = inferences.flatMap((inference) => {
    if (inference.stage === "health" && inference.value.health !== "healthy") return [`${inference.sensor}: health ${inference.value.health}`];
    if (inference.stage === "drift" && inference.value.drifting) return [`${inference.sensor}: drift, rate ${inference.value.ratePer1000.toFixed(2)} per 1000 steps`];
    return [];
  });
  if (lines.length === 0) return null;
  return { kind: "sensor-alert", title: `${run.name}: ${lines.length} sensor${lines.length === 1 ? "" : "s"} out of range`, message: lines.join("\n"), runId: run.id };
}

export const runFinished = (run: Run, ms: number): NotificationDraft => ({
  kind: "run-finished",
  title: `${run.name}: run finished`,
  message: `${run.sensorCount} sensors, ${run.gridSize} steps, ${Math.round(ms / 1000)} s`,
  runId: run.id,
});

export const runFailed = (run: Run, error: string): NotificationDraft => ({ kind: "run-failed", title: `${run.name}: run failed`, message: error, runId: run.id });
