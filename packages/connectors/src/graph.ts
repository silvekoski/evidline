import { z } from "zod";
import { ConnectorError, type Transport } from "./types";

export const GRAPH = "https://graph.microsoft.com/v1.0";

export type GraphAuth = { tenantId: string; clientId: string; clientSecret: string };

const tokenResponse = z.object({ access_token: z.string(), expires_in: z.number() });
const tokens = new Map<string, { token: string; expiresAt: number }>();

export async function graphToken(auth: GraphAuth, transport: Transport, now: () => Date): Promise<string> {
  const key = `${auth.tenantId}:${auth.clientId}`;
  const cached = tokens.get(key);
  if (cached && cached.expiresAt > now().getTime() + 60_000) return cached.token;
  const body = new URLSearchParams({ client_id: auth.clientId, client_secret: auth.clientSecret, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" });
  const res = await transport(`https://login.microsoftonline.com/${auth.tenantId}/oauth2/v2.0/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: body.toString() });
  if (res.status !== 200) throw new ConnectorError(`token request failed with ${res.status}: ${res.text.slice(0, 200)}`, "auth");
  const parsed = tokenResponse.parse(JSON.parse(res.text));
  tokens.set(key, { token: parsed.access_token, expiresAt: now().getTime() + parsed.expires_in * 1000 });
  return parsed.access_token;
}

export type GraphClient = {
  get<T = unknown>(path: string): Promise<T>;
  getRaw(path: string, accept: string): Promise<Buffer>;
  post<T = unknown>(path: string, body: unknown): Promise<T>;
  patch(path: string, body: unknown): Promise<void>;
  delete(path: string): Promise<void>;
  pages<T>(path: string): AsyncIterable<{ items: T[]; deltaLink: string | null }>;
};

const errorCode = (text: string): string => {
  try {
    const body = JSON.parse(text) as { error?: { code?: string; innerError?: { code?: string } } };
    return body.error?.innerError?.code ?? body.error?.code ?? "graph";
  } catch {
    return "graph";
  }
};

export function graphClient(auth: GraphAuth, transport: Transport, now: () => Date): GraphClient {
  const call = async (path: string, init: { method?: string; body?: string; accept?: string } = {}) => {
    const token = await graphToken(auth, transport, now);
    const url = path.startsWith("http") ? path : `${GRAPH}${path}`;
    const headers: Record<string, string> = { authorization: `Bearer ${token}`, accept: init.accept ?? "application/json" };
    if (init.body !== undefined) headers["content-type"] = "application/json";
    const res = await transport(url, { method: init.method ?? "GET", headers, body: init.body });
    if (res.status === 429 || res.status === 503) {
      const wait = Math.min(60, Number(res.headers["retry-after"] ?? 5)) * 1000;
      await new Promise((r) => setTimeout(r, wait));
      return transport(url, { method: init.method ?? "GET", headers, body: init.body });
    }
    return res;
  };
  const check = (res: Awaited<ReturnType<Transport>>, path: string) => {
    if (res.status >= 200 && res.status < 300) return;
    const code = errorCode(res.text);
    if (code === "GraphAccessToTranscriptsDisabled") throw new ConnectorError("A tenant admin turned off Graph access to transcripts (GraphAccessToTranscriptsDisabled).", code);
    throw new ConnectorError(`Graph ${res.status} on ${path}: ${res.text.slice(0, 300)}`, code);
  };
  const client: GraphClient = {
    async get(path) {
      const res = await call(path);
      check(res, path);
      return JSON.parse(res.text);
    },
    async getRaw(path, accept) {
      const res = await call(path, { accept });
      check(res, path);
      return res.bytes();
    },
    async post(path, body) {
      const res = await call(path, { method: "POST", body: JSON.stringify(body) });
      check(res, path);
      return res.text ? JSON.parse(res.text) : undefined;
    },
    async patch(path, body) {
      check(await call(path, { method: "PATCH", body: JSON.stringify(body) }), path);
    },
    async delete(path) {
      check(await call(path, { method: "DELETE" }), path);
    },
    async *pages(path) {
      let next: string | null = path;
      while (next) {
        const page = (await client.get(next)) as { value?: unknown[]; "@odata.nextLink"?: string; "@odata.deltaLink"?: string };
        next = page["@odata.nextLink"] ?? null;
        yield { items: (page.value ?? []) as never[], deltaLink: page["@odata.deltaLink"] ?? null };
      }
    },
  };
  return client;
}

export const graphAuth = (config: { tenantId: string; clientId: string }, secret: string | null): GraphAuth => {
  if (!secret) throw new ConnectorError("the connector has no client secret", "auth");
  return { tenantId: config.tenantId, clientId: config.clientId, clientSecret: secret };
};
