import { z } from "zod";
import type { Provider } from "../gateway";
import { send } from "./transport";
import { jsonSchemaOf } from "./json-schema";

export type OpenAiConfig = { url: string; key: string; model: string; region: string | null };

const completion = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string() }) })) });

export function createOpenAiProvider(cfg: OpenAiConfig): Provider {
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
        response_format: { type: "json_schema", json_schema: { name: "response", strict: true, schema: jsonSchemaOf(schema) } },
        temperature: 0,
      });
      const res = await send(cfg.url, { headers: { "content-type": "application/json", authorization: `Bearer ${cfg.key}` }, body });
      if (res.status < 200 || res.status >= 300) throw new Error(`openai ${res.status}: ${res.text.slice(0, 300)}`);
      const content = completion.safeParse(JSON.parse(res.text)).data?.choices[0]?.message.content;
      if (content === undefined) throw new Error(`openai response has no choices[0].message.content: ${res.text.slice(0, 300)}`);
      return content.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, "");
    },
  };
}
