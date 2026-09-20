import type { Transport } from "./types";

export type ResendConfig = { apiKey: string; from: string; to: string[] };
export type InlineImage = { filename: string; contentId: string; content: Buffer };
export type Alert = { title: string; message: string; html?: string; images?: InlineImage[] };

export async function sendResendAlert(transport: Transport, config: ResendConfig, alert: Alert): Promise<{ ok: true; id: string | null } | { ok: false; error: string }> {
  const attachments = (alert.images ?? []).map((image) => ({ filename: image.filename, content_id: image.contentId, content: image.content.toString("base64") }));
  const res = await transport("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: config.from, to: config.to, subject: alert.title, text: alert.message, ...(alert.html ? { html: alert.html } : {}), ...(attachments.length > 0 ? { attachments } : {}) }),
  });
  if (res.status < 200 || res.status >= 300) return { ok: false, error: `${res.status} ${res.text}` };
  let id: string | null = null;
  try {
    id = (JSON.parse(res.text) as { id?: string }).id ?? null;
  } catch {
    id = null;
  }
  return { ok: true, id };
}
