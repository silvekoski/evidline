export type Transport = (url: string, init: { headers: Record<string, string>; body: string }) => Promise<{ status: number; text: string }>;

export const send: Transport = async (url, { headers, body }) => {
  const res = await fetch(url, { method: "POST", headers, body, signal: AbortSignal.timeout(60_000) });
  return { status: res.status, text: await res.text() };
};
