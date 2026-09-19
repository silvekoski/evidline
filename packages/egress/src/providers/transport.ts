export type Transport = (
  url: string,
  init: { headers: Record<string, string>; body: string; timeoutMs?: number },
) => Promise<{ status: number; text: string; headers?: Record<string, string> }>;

export const send: Transport = async (url, { headers, body, timeoutMs = 60_000 }) => {
  const res = await fetch(url, { method: "POST", headers, body, signal: AbortSignal.timeout(timeoutMs) });
  return { status: res.status, text: await res.text(), headers: Object.fromEntries(res.headers) };
};

export const sendForm = async (url: string, headers: Record<string, string>, form: FormData): Promise<{ status: number; text: string }> => {
  const res = await fetch(url, { method: "POST", headers, body: form, signal: AbortSignal.timeout(600_000) });
  return { status: res.status, text: await res.text() };
};
