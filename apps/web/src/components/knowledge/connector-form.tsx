import type { ConnectorKind } from "@tpm/schemas";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Field = { key: string; label: string; kind: "text" | "number" | "list" | "map" | "url"; required?: boolean; placeholder?: string; hint?: string; defaultValue?: string };

export const connectorFields: Record<ConnectorKind, { hint: string; secret: string | null; fields: Field[] }> = {
  upload: { hint: "No settings. Signed upload links come from the Sources page.", secret: null, fields: [] },
  teams: {
    hint: "Entra app with application permissions. Organizers are the Norrin users that host customer calls.",
    secret: "client secret",
    fields: [
      { key: "tenantId", label: "Tenant id", kind: "text", required: true, placeholder: "00000000-0000-0000-0000-000000000000" },
      { key: "clientId", label: "Client id", kind: "text", required: true },
      { key: "organizers", label: "Organizers", kind: "list", required: true, placeholder: "anna@norrin.example, jarkko@norrin.example", hint: "Email addresses, separated by commas." },
      { key: "notificationUrl", label: "Webhook URL", kind: "url", placeholder: "https://plant.example/api/webhooks/graph", hint: "Leave empty to poll every 10 minutes." },
      { key: "lookbackDays", label: "Look back (days)", kind: "number", defaultValue: "7" },
    ],
  },
  email: {
    hint: "Shared mailbox read through Graph with Mail.Read. The plus address maps a mail to a workspace.",
    secret: "client secret",
    fields: [
      { key: "tenantId", label: "Tenant id", kind: "text", required: true },
      { key: "clientId", label: "Client id", kind: "text", required: true },
      { key: "mailbox", label: "Mailbox", kind: "text", required: true, placeholder: "corpus@norrin.example" },
      { key: "folder", label: "Folder", kind: "text", defaultValue: "inbox" },
    ],
  },
  slack: {
    hint: "Internal Slack app in Socket Mode. Map each channel id to a workspace slug.",
    secret: "bot token (xoxb-…)",
    fields: [
      { key: "channels", label: "Channels", kind: "map", required: true, placeholder: "C0123ABC acme\nC0456DEF norrin", hint: "One line per channel: the channel id, a space, the workspace slug." },
      { key: "appToken", label: "App token", kind: "text", placeholder: "xapp-…", hint: "Needed for Socket Mode. Without it the connector only backfills." },
      { key: "backfillDays", label: "Backfill (days)", kind: "number", defaultValue: "90" },
    ],
  },
};

export type ConnectorValues = Record<string, string>;

export const defaultValues = (kind: ConnectorKind): ConnectorValues => Object.fromEntries(connectorFields[kind].fields.map((f) => [f.key, f.defaultValue ?? ""]));

export function toConfig(kind: ConnectorKind, values: ConnectorValues): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of connectorFields[kind].fields) {
    const raw = (values[field.key] ?? "").trim();
    if (raw === "") continue;
    if (field.kind === "number") out[field.key] = Number(raw);
    else if (field.kind === "list") out[field.key] = raw.split(/[\s,;]+/).filter(Boolean);
    else if (field.kind === "map") out[field.key] = Object.fromEntries(raw.split("\n").map((line) => line.trim().split(/[\s=:]+/)).filter((p) => p.length >= 2).map(([k, v]) => [k, v]));
    else out[field.key] = raw;
  }
  return out;
}

export const isComplete = (kind: ConnectorKind, values: ConnectorValues): boolean => connectorFields[kind].fields.every((f) => !f.required || (values[f.key] ?? "").trim() !== "");

export function ConnectorFields({ kind, values, onChange }: { kind: ConnectorKind; values: ConnectorValues; onChange: (values: ConnectorValues) => void }) {
  const set = (key: string, value: string) => onChange({ ...values, [key]: value });
  return (
    <>
      {connectorFields[kind].fields.map((field) => {
        const id = `c-${field.key}`;
        const common = { id, value: values[field.key] ?? "", required: field.required, placeholder: field.placeholder, "aria-describedby": field.hint ? `${id}-hint` : undefined };
        return (
          <div key={field.key} className="grid gap-1.5">
            <Label htmlFor={id}>{field.label}</Label>
            {field.kind === "map" ? (
              <Textarea {...common} rows={3} className="font-mono text-xs" onChange={(e) => set(field.key, e.target.value)} />
            ) : (
              <Input {...common} type={field.kind === "number" ? "number" : field.kind === "url" ? "url" : "text"} min={field.kind === "number" ? 1 : undefined} onChange={(e) => set(field.key, e.target.value)} />
            )}
            {field.hint && (
              <p id={`${id}-hint`} className="text-xs text-muted-foreground">
                {field.hint}
              </p>
            )}
          </div>
        );
      })}
    </>
  );
}
