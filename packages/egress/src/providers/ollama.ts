import { z } from "zod";
import type { Provider } from "../gateway";
import { send } from "./transport";
import { jsonSchemaOf } from "./json-schema";

export type OllamaConfig = { host: string; model: string };

const chat = z.object({ message: z.object({ content: z.string() }) });

export function createOllamaProvider(cfg: OllamaConfig): Provider {
  const host = cfg.host.replace(/\/+$/, "");
  return {
    name: "ollama",
    model: cfg.model,
    region: null,
    host,
    async call(payloadText, template, schema) {
      const body = JSON.stringify({
        model: cfg.model,
        messages: [
          { role: "system", content: template },
          { role: "user", content: payloadText },
        ],
        format: jsonSchemaOf(schema),
        stream: false,
        options: { temperature: 0 },
      });
      const res = await send(`${host}/api/chat`, { headers: { "content-type": "application/json" }, body });
      if (res.status < 200 || res.status >= 300) throw new Error(`ollama ${res.status}: ${res.text.slice(0, 300)}`);
      const content = chat.safeParse(JSON.parse(res.text)).data?.message.content;
      if (content === undefined) throw new Error(`ollama response has no message.content: ${res.text.slice(0, 300)}`);
      return content;
    },
  };
}
