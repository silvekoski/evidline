import { z } from "zod";
import type { Provider } from "../gateway";
import { send, type Transport } from "./transport";
import { jsonSchemaOf } from "./json-schema";

export type OpenAiConfig = { url: string; key: string; model: string; region: string | null; structured?: boolean; transport?: Transport };

const completion = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string() }), finish_reason: z.string().nullish() })) });

const retryAfterMs = (headers: Record<string, string> | undefined): number => {
  const raw = headers?.["retry-after"];
  const seconds = raw === undefined ? 5 : Number(raw) || (Date.parse(raw) - Date.now()) / 1000 || 5;
  return Math.min(30, Math.max(0, seconds)) * 1000;
};

export function createOpenAiProvider(cfg: OpenAiConfig): Provider {
  const structured = cfg.structured ?? true;
  const transport = cfg.transport ?? send;
  return {
    name: "openai-compatible",
    model: cfg.model,
    region: cfg.region,
    host: new URL(cfg.url).host,
    async call(payloadText, template, schema) {
      const body = JSON.stringify({
        model: cfg.model,
        messages: [
          { role: "system", content: template },
          { role: "user", content: payloadText },
        ],
        temperature: 0,
        ...(structured
          ? { response_format: { type: "json_schema", json_schema: { name: "response", strict: true, schema: jsonSchemaOf(schema) } } }
          : { max_tokens: 4096, chat_template_kwargs: { enable_thinking: false } }),
      });
      const init = { headers: { "content-type": "application/json", authorization: `Bearer ${cfg.key}` }, body, timeoutMs: structured ? 60_000 : 120_000 };
      let res = await transport(cfg.url, init);
      if (res.status === 429) {
        await new Promise((resolve) => setTimeout(resolve, retryAfterMs(res.headers)));
        res = await transport(cfg.url, init);
      }
      if (res.status < 200 || res.status >= 300) throw new Error(`openai ${res.status}: ${res.text.slice(0, 300)}`);
      const choice = completion.safeParse(JSON.parse(res.text)).data?.choices[0];
      if (choice === undefined) throw new Error(`openai response has no choices[0].message.content: ${res.text.slice(0, 300)}`);
      if (choice.finish_reason === "length") throw new Error("openai response truncated at max_tokens");
      return choice.message.content;
    },
  };
}
