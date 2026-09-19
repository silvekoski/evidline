import { z } from "zod";
import { send, type Provider } from "../gateway";
import { jsonSchemaOf } from "./json-schema";

export type AzureConfig = { endpoint: string; key: string; deployment: string; region: string | null };

const completion = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string() }) })) });

export function createAzureProvider(cfg: AzureConfig): Provider {
  const host = cfg.endpoint.replace(/\/+$/, "");
  return {
    name: "azure",
    model: cfg.deployment,
    region: cfg.region,
    host,
    async call(payloadText, template, schema) {
      const url = `${host}/openai/deployments/${encodeURIComponent(cfg.deployment)}/chat/completions?api-version=2024-10-21`;
      const body = JSON.stringify({
        messages: [
          { role: "system", content: template },
          { role: "user", content: payloadText },
        ],
        response_format: { type: "json_schema", json_schema: { name: "response", schema: jsonSchemaOf(schema) } },
        temperature: 0,
      });
      const res = await send(url, { headers: { "content-type": "application/json", "api-key": cfg.key }, body });
      if (res.status < 200 || res.status >= 300) throw new Error(`azure ${res.status}: ${res.text.slice(0, 300)}`);
      const content = completion.safeParse(JSON.parse(res.text)).data?.choices[0]?.message.content;
      if (content === undefined) throw new Error(`azure response has no choices[0].message.content: ${res.text.slice(0, 300)}`);
      return content;
    },
  };
}
