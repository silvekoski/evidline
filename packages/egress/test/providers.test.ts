import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAzureProvider, createOllamaProvider, getProvider, templates } from "../src/index";
import { nameRolePayload, replies, testGateway } from "./fixtures";

type Seen = { method: string; url: string; headers: IncomingMessage["headers"]; body: Record<string, unknown> };
const seen: Seen[] = [];
let server: Server;
let host = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => (raw += chunk.toString()));
    req.on("end", () => {
      const body = JSON.parse(raw) as Record<string, unknown>;
      seen.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, body });
      res.setHeader("content-type", "application/json");
      if (req.url?.startsWith("/openai/")) {
        if (req.headers["api-key"] !== "secret") {
          res.statusCode = 401;
          res.end(JSON.stringify({ error: "bad key" }));
          return;
        }
        res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: replies.name_role } }] }));
      } else if (req.url === "/api/chat") {
        res.end(JSON.stringify({ model: (body.model as string) ?? "", message: { role: "assistant", content: replies.name_role } }));
      } else {
        res.statusCode = 404;
        res.end("{}");
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  host = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const ctx = { runId: "0123abcd", inferenceId: null, operatorText: false };

describe("azure provider", () => {
  it("posts to the deployment path with the api-key header and a json_schema response format", async () => {
    const provider = createAzureProvider({ endpoint: `${host}/`, key: "secret", deployment: "gpt-4o", region: "swedencentral" });
    const { gateway, store } = testGateway({ mode: "cloud", provider });
    const result = await gateway.call<{ name: string }>("name_role", nameRolePayload, ctx);
    expect(result).toMatchObject({ ok: true, source: "model", value: { name: "temperature" } });
    const request = seen[seen.length - 1] as Seen;
    expect(request.method).toBe("POST");
    expect(request.url).toBe("/openai/deployments/gpt-4o/chat/completions?api-version=2024-10-21");
    expect(request.headers["api-key"]).toBe("secret");
    expect(request.headers["content-type"]).toBe("application/json");
    const format = request.body.response_format as {
      type: string;
      json_schema: { name: string; schema: { type: string; properties: Record<string, unknown> } };
    };
    expect(format.type).toBe("json_schema");
    expect(format.json_schema.schema.type).toBe("object");
    expect(Object.keys(format.json_schema.schema.properties)).toEqual(["name", "quantity", "confidence", "reason"]);
    const messages = request.body.messages as { role: string; content: string }[];
    expect(messages[0]).toEqual({ role: "system", content: templates.name_role });
    expect(messages[1]?.content).toBe(store.records[0]?.payload);
    expect(store.records[0]).toMatchObject({
      status: "sent",
      provider: { name: "azure", model: "gpt-4o", region: "swedencentral", host },
      response: replies.name_role,
    });
  });

  it("records an error on a non-2xx status", async () => {
    const provider = createAzureProvider({ endpoint: host, key: "wrong", deployment: "gpt-4o", region: null });
    const { gateway, store } = testGateway({ mode: "cloud", provider });
    const result = await gateway.call("name_role", nameRolePayload, ctx);
    expect(result.ok === false && result.reason).toContain("azure 401");
    expect(store.records[0]?.status).toBe("error");
  });
});

describe("ollama provider", () => {
  it("posts to /api/chat with the schema as format and stream false", async () => {
    const provider = createOllamaProvider({ host, model: "llama3.1" });
    const { gateway, store } = testGateway({ mode: "local", provider });
    const result = await gateway.call<{ name: string }>("name_role", nameRolePayload, ctx);
    expect(result).toMatchObject({ ok: true, source: "model", value: { name: "temperature", confidence: 0.6 } });
    const request = seen[seen.length - 1] as Seen;
    expect(request.url).toBe("/api/chat");
    expect(request.body.model).toBe("llama3.1");
    expect(request.body.stream).toBe(false);
    expect((request.body.format as { type: string }).type).toBe("object");
    const messages = request.body.messages as { role: string; content: string }[];
    expect(messages[0]).toEqual({ role: "system", content: templates.name_role });
    expect(messages[1]?.content).toBe(store.records[0]?.payload);
    expect(store.records[0]).toMatchObject({
      status: "sent",
      mode: "local",
      provider: { name: "ollama", model: "llama3.1", region: null, host },
    });
  });
});

describe("getProvider from the environment", () => {
  const keys = ["TPM_AZURE_ENDPOINT", "TPM_AZURE_KEY", "TPM_AZURE_DEPLOYMENT", "TPM_AZURE_REGION", "TPM_OLLAMA_HOST", "TPM_OLLAMA_MODEL"];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  afterAll(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("returns null when the variables are missing", () => {
    for (const k of keys) delete process.env[k];
    expect(getProvider("cloud")).toBeNull();
    expect(getProvider("local")).toBeNull();
    expect(getProvider("off")).toBeNull();
    process.env.TPM_AZURE_ENDPOINT = "https://example.openai.azure.com";
    process.env.TPM_AZURE_KEY = "k";
    expect(getProvider("cloud")).toBeNull();
  });

  it("builds the providers from the variables and takes the host from the environment only", () => {
    process.env.TPM_AZURE_ENDPOINT = "https://example.openai.azure.com/";
    process.env.TPM_AZURE_KEY = "k";
    process.env.TPM_AZURE_DEPLOYMENT = "gpt-4o";
    process.env.TPM_AZURE_REGION = "swedencentral";
    expect(getProvider("cloud")).toMatchObject({
      name: "azure",
      model: "gpt-4o",
      region: "swedencentral",
      host: "https://example.openai.azure.com",
    });
    delete process.env.TPM_AZURE_REGION;
    expect(getProvider("cloud")).toMatchObject({ region: null });
    process.env.TPM_OLLAMA_HOST = "http://localhost:11434";
    process.env.TPM_OLLAMA_MODEL = "llama3.1";
    expect(getProvider("local")).toMatchObject({ name: "ollama", model: "llama3.1", region: null, host: "http://localhost:11434" });
    expect(getProvider("off")).toBeNull();
  });
});
