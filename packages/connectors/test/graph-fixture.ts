import type { Transport } from "../src/types";

export type Recorded = { match: RegExp | string; status?: number; body: unknown; headers?: Record<string, string> };

export function recordedTransport(recordings: Recorded[]): Transport & { calls: { url: string; method: string; body?: string }[] } {
  const calls: { url: string; method: string; body?: string }[] = [];
  const transport = (async (url: string, init?: { method?: string | undefined; body?: string | undefined }) => {
    calls.push({ url, method: init?.method ?? "GET", ...(init?.body !== undefined ? { body: init.body } : {}) });
    const hit = recordings.find((r) => (typeof r.match === "string" ? url.includes(r.match) : r.match.test(url)));
    if (!hit) return { status: 404, headers: {}, text: JSON.stringify({ error: { code: "NotFound", message: url } }), bytes: async () => Buffer.alloc(0) };
    const text = typeof hit.body === "string" ? hit.body : JSON.stringify(hit.body);
    return { status: hit.status ?? 200, headers: hit.headers ?? {}, text, bytes: async () => Buffer.from(text) };
  }) as Transport & { calls: typeof calls };
  transport.calls = calls;
  return transport;
}

export const token = { match: "/oauth2/v2.0/token", body: { access_token: "t0k", expires_in: 3600 } };

export const vtt = `WEBVTT

00:00:01.000 --> 00:00:04.000
<v Matti Virtanen>Kuivaimen 3 höyryventtiili jumittuu pesun jälkeen.</v>

00:00:05.000 --> 00:00:08.000
<v Anna Data>So the valve position column lags the wash.</v>
`;
