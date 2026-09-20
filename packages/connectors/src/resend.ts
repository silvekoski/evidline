import type { Transport } from "./types";

export type ResendConfig = { apiKey: string; from: string; to: string[] };
export type Alert = { title: string; message: string };

export async function sendResendAlert(transport: Transport, config: ResendConfig, alert: Alert): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await transport("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: config.from, to: config.to, subject: alert.title, text: alert.message }),
  });
  return res.status >= 200 && res.status < 300 ? { ok: true } : { ok: false, error: `${res.status} ${res.text}` };
}
