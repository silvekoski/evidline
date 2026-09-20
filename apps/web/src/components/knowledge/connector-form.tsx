import { useState } from "react";
import { ChevronDownIcon, MailIcon, MessageSquareIcon, PhoneIcon, UploadIcon, type LucideIcon } from "lucide-react";
import type { ConnectorKind } from "@tpm/schemas";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "cn";

type Field = {
  key: string;
  label: string;
  kind: "text" | "number" | "list" | "map" | "url" | "secret";
  required?: boolean;
  advanced?: boolean;
  placeholder?: string;
  hint?: string;
  defaultValue?: string;
};

type KindSpec = { label: string; icon: LucideIcon; description: string; namePlaceholder: string; fields: Field[] };

const entraFields: Field[] = [
  { key: "tenantId", label: "Tenant id", kind: "text", required: true, placeholder: "00000000-0000-0000-0000-000000000000", hint: "Entra admin center, App registrations, Overview." },
  { key: "clientId", label: "Client id", kind: "text", required: true, placeholder: "00000000-0000-0000-0000-000000000000", hint: "Also on the Overview page of the app registration." },
  { key: "secret", label: "Client secret", kind: "secret", required: true, hint: "Certificates & secrets of the app registration. The value shows once." },
];

export const connectorKinds: Record<ConnectorKind, KindSpec> = {
  teams: {
    label: "Microsoft Teams",
    icon: PhoneIcon,
    description: "Transcripts of customer calls.",
    namePlaceholder: "Customer calls",
    fields: [
      ...entraFields,
      { key: "organizers", label: "Call organizers", kind: "list", required: true, placeholder: "anna@norrin.example, jarkko@norrin.example", hint: "The Norrin users that host customer calls. Separate the addresses with commas." },
      { key: "notificationUrl", label: "Webhook URL", kind: "url", advanced: true, placeholder: "https://plant.example/api/webhooks/graph", hint: "Graph posts new transcripts here. Leave empty to poll every 10 minutes." },
      { key: "lookbackDays", label: "Days of history", kind: "number", advanced: true, defaultValue: "7", hint: "The first sync reads this many days back. 1 to 90." },
    ],
  },
  slack: {
    label: "Slack",
    icon: MessageSquareIcon,
    description: "Threads from customer channels.",
    namePlaceholder: "Customer channels",
    fields: [
      { key: "channels", label: "Channels", kind: "map", required: true, placeholder: "C0123ABC acme\nC0456DEF norrin", hint: "One line per channel: the channel id, a space, the workspace slug. The channel id is in the channel details." },
      { key: "secret", label: "Bot token", kind: "secret", required: true, placeholder: "xoxb-…", hint: "OAuth & Permissions of the Slack app." },
      { key: "appToken", label: "App token", kind: "text", advanced: true, placeholder: "xapp-…", hint: "Basic Information of the Slack app. With it, threads arrive live. Without it, the connector only backfills." },
      { key: "backfillDays", label: "Days of history", kind: "number", advanced: true, defaultValue: "90", hint: "The first sync reads this many days back. 1 to 365." },
    ],
  },
  email: {
    label: "Email",
    icon: MailIcon,
    description: "Mail from a shared mailbox.",
    namePlaceholder: "Shared mailbox",
    fields: [
      ...entraFields,
      { key: "mailbox", label: "Mailbox", kind: "text", required: true, placeholder: "corpus@norrin.example", hint: "A plus address such as corpus+acme@norrin.example maps a mail to the workspace acme." },
      { key: "folder", label: "Folder", kind: "text", advanced: true, defaultValue: "inbox" },
    ],
  },
  upload: {
    label: "Upload",
    icon: UploadIcon,
    description: "Signed upload links.",
    namePlaceholder: "Upload links",
    fields: [],
  },
};

export type ConnectorValues = Record<string, string>;

export const defaultValues = (kind: ConnectorKind): ConnectorValues => Object.fromEntries(connectorKinds[kind].fields.map((f) => [f.key, f.defaultValue ?? ""]));

export function toConfig(kind: ConnectorKind, values: ConnectorValues): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of connectorKinds[kind].fields) {
    const raw = (values[field.key] ?? "").trim();
    if (raw === "" || field.kind === "secret") continue;
    if (field.kind === "number") out[field.key] = Number(raw);
    else if (field.kind === "list") out[field.key] = raw.split(/[\s,;]+/).filter(Boolean);
    else if (field.kind === "map") out[field.key] = Object.fromEntries(raw.split("\n").map((line) => line.trim().split(/[\s=:]+/)).filter((p) => p.length >= 2).map(([k, v]) => [k, v]));
    else out[field.key] = raw;
  }
  return out;
}

export const isComplete = (kind: ConnectorKind, values: ConnectorValues): boolean => connectorKinds[kind].fields.every((f) => !f.required || (values[f.key] ?? "").trim() !== "");

const inputType: Record<Field["kind"], string> = { text: "text", number: "number", list: "text", map: "text", url: "url", secret: "password" };

function ConnectorField({ field, value, onChange }: { field: Field; value: string; onChange: (value: string) => void }) {
  const id = `c-${field.key}`;
  const hint = field.kind === "secret" ? `${field.hint ?? ""} Stored with AES-256-GCM. The browser never gets it back.`.trim() : field.hint;
  const common = { id, value, required: field.required, placeholder: field.placeholder, "aria-describedby": hint ? `${id}-hint` : undefined };
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{field.label}</Label>
      {field.kind === "map" ? (
        <Textarea {...common} rows={3} className="font-mono text-xs" onChange={(e) => onChange(e.target.value)} />
      ) : (
        <Input
          {...common}
          type={inputType[field.kind]}
          min={field.kind === "number" ? 1 : undefined}
          autoComplete={field.kind === "secret" ? "off" : undefined}
          className={cn(field.kind === "secret" && "font-mono")}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

export function ConnectorFields({ kind, values, onChange }: { kind: ConnectorKind; values: ConnectorValues; onChange: (values: ConnectorValues) => void }) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const { fields } = connectorKinds[kind];
  const advanced = fields.filter((f) => f.advanced);
  const render = (field: Field) => <ConnectorField key={field.key} field={field} value={values[field.key] ?? ""} onChange={(value) => onChange({ ...values, [field.key]: value })} />;
  return (
    <>
      {fields.filter((f) => !f.advanced).map(render)}
      {advanced.length > 0 && (
        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen} className="flex flex-col gap-4">
          <CollapsibleTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="w-fit -ml-2">
              <ChevronDownIcon aria-hidden="true" className={cn("transition-transform motion-reduce:transition-none", advancedOpen && "rotate-180")} />
              Advanced settings
              <span className="font-normal text-muted-foreground">(optional)</span>
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="flex flex-col gap-4">{advanced.map(render)}</CollapsibleContent>
        </Collapsible>
      )}
    </>
  );
}
