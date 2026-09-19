import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ZodType } from "zod";

export const badRequest = (message: string): HTTPException => new HTTPException(400, { message });
export const notFound = (what: string): HTTPException => new HTTPException(404, { message: `${what} not found` });

export async function parseBody<T>(c: Context, schema: ZodType<T>): Promise<T> {
  const parsed = schema.safeParse(await c.req.json().catch(() => undefined));
  if (!parsed.success) throw badRequest(parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join(", "));
  return parsed.data;
}

export const runIdQuery = (c: Context): string | undefined => c.req.query("runId") || undefined;
