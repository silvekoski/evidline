export type Transport = (url: string, init: { headers: Record<string, string>; body: string }) => Promise<{ status: number; text: string }>;

export const send: Transport = async (url, { headers, body }) => {
  const res = await fetch(url, { method: "POST", headers, body, signal: AbortSignal.timeout(60_000) });
  return { status: res.status, text: await res.text() };
};

export const sendForm = async (url: string, headers: Record<string, string>, form: FormData): Promise<{ status: number; text: string }> => {
  const res = await fetch(url, { method: "POST", headers, body: form, signal: AbortSignal.timeout(600_000) });
  return { status: res.status, text: await res.text() };
};
