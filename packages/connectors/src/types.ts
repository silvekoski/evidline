import type { z } from "zod";
import type { SegmentDraft } from "@tpm/corpus";
import type { ConnectorKind, SourceKind } from "@tpm/schemas";

export type RawAttachment = { name: string; mediaType: string; content: Buffer };

export type WorkspaceHint = { channelId?: string; plusTag?: string; domains?: string[] };

export type RawSource = {
  kind: SourceKind;
  externalId: string;
  title: string;
  occurredAt: string;
  segments: SegmentDraft[];
  attachments: RawAttachment[];
  hint: WorkspaceHint;
  externalUrl?: string | null;
  deleted?: boolean;
};

export type TransportInit = { method?: string | undefined; headers?: Record<string, string> | undefined; body?: string | undefined };
export type Transport = (url: string, init?: TransportInit) => Promise<{ status: number; headers: Record<string, string>; text: string; bytes(): Promise<Buffer> }>;

export type SyncContext = { transport: Transport; now: () => Date; log: (line: string) => void };

export type SyncItem = { source: RawSource; cursor: string | null };

export interface Connector<C> {
  readonly kind: ConnectorKind;
  readonly configSchema: z.ZodType<C>;
  sync(config: C, secret: string | null, cursor: string | null, ctx: SyncContext): AsyncIterable<SyncItem>;
  handleWebhook?(body: unknown, config: C, secret: string | null, ctx: SyncContext): Promise<RawSource[]>;
}

export class ConnectorError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

export const fetchTransport: Transport = async (url, init) => {
  const res = await fetch(url, { method: init?.method ?? "GET", headers: init?.headers ?? {}, body: init?.body ?? null, signal: AbortSignal.timeout(60_000) });
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => (headers[k] = v));
  const raw = Buffer.from(await res.arrayBuffer());
  return { status: res.status, headers, text: raw.toString("utf8"), bytes: async () => raw };
};

export const emailDomain = (address: string): string | null => address.split("@")[1]?.toLowerCase() ?? null;
