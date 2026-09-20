import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Alert, InlineImage } from "@tpm/connectors";
import { repoRoot } from "./paths";

const logo: InlineImage = { filename: "evidline-logo.png", contentId: "evidline-logo", content: readFileSync(join(repoRoot, "apps", "server", "assets", "evidline-logo.png")) };

const escape = (text: string): string => text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export type EmailDebug = Record<string, string>;

export function brandedEmail(title: string, message: string, link: { label: string; url: string } | null, debug: EmailDebug): Alert {
  const debugText = Object.entries(debug).map(([key, value]) => `${key}: ${value}`).join("\n");
  const debugHtml = Object.entries(debug).map(([key, value]) => `${escape(key)}: ${escape(value)}`).join("<br>");
  const lines = message.split("\n").map(escape).join("<br>");
  const button = link
    ? `<p style="margin:24px 0 0"><a href="${escape(link.url)}" style="display:inline-block;padding:10px 18px;border-radius:6px;background:#f5a524;color:#1a1a1a;font-weight:600;text-decoration:none">${escape(link.label)}</a></p>`
    : "";
  const html = `<!DOCTYPE html>
<html lang="en"><body style="margin:0;padding:24px;background:#f4f4f4;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1a1a1a">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
<table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:8px;padding:32px">
<tr><td><img src="cid:${logo.contentId}" alt="evidline" width="140" height="34" style="display:block;border:0"></td></tr>
<tr><td style="padding-top:24px;font-size:18px;font-weight:600">${escape(title)}</td></tr>
<tr><td style="padding-top:12px;font-size:14px;line-height:1.5;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">${lines}</td></tr>
<tr><td>${button}</td></tr>
<tr><td style="padding-top:32px;font-size:12px;color:#6b6b6b">evidline sent this notification. Change which events send an email in the notification center.</td></tr>
<tr><td style="padding-top:16px;font-size:11px;line-height:1.5;color:#8a8a8a;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">${debugHtml}</td></tr>
</table></td></tr></table></body></html>`;
  const text = [message, ...(link ? [`${link.label}: ${link.url}`] : []), debugText].join("\n\n");
  return { title, message: text, html, images: [logo] };
}
