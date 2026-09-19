import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TextEgressRow } from "@tpm/schemas";
import { createHashEmbedder, createTextGateway, hashEmbed, numericShare, textGuard } from "../src/index";
import { createOpenAiEmbedder, embeddingsUrl } from "../src/text/openai-embedder";
import { chatUrl, createOpenAiOcr } from "../src/text/ocr";
import { createElevenLabsTranscriber } from "../src/text/transcriber";

const dot = (a: Float32Array, b: Float32Array) => a.reduce((s, v, i) => s + v * b[i]!, 0);

describe("text guard", () => {
  it("passes prose and blocks a numeric payload", () => {
    expect(textGuard(["The dryer 3 steam valve sticks after a wash."]).pass).toBe(true);
    const rows = Array.from({ length: 40 }, (_, i) => `${i * 1.5} ${i * 2.25} ${i * 3}`).join("\n");
    expect(numericShare(rows)).toBeGreaterThan(0.9);
    expect(textGuard([rows]).pass).toBe(false);
    expect(textGuard(["a".repeat(8001)]).detail).toContain("8001 characters");
  });
});

describe("hash embedder", () => {
  it("puts similar texts closer than different texts and normalizes", () => {
    const a = hashEmbed("höyryventtiili kuivain 3 jumissa");
    const b = hashEmbed("kuivaimen 3 höyryventtiili on jumissa");
    const c = hashEmbed("invoice total for March");
    expect(dot(a, a)).toBeCloseTo(1, 5);
    expect(dot(a, b)).toBeGreaterThan(dot(a, c));
  });
});

function memoryStore() {
  const rows: Omit<TextEgressRow, "id">[] = [];
  return { rows, write: (row: Omit<TextEgressRow, "id">) => void rows.push(row) };
}

describe("text gateway", () => {
  it("embeds locally in mode off and logs a local row without the text", async () => {
    const store = memoryStore();
    const gateway = createTextGateway({ store, getMode: () => "off" });
    const result = await gateway.embed(["steam valve"], "passage");
    expect(result.ok && result.value[0]!.length).toBe(1024);
    expect(store.rows[0]).toMatchObject({ purpose: "embed", status: "local", destination: "local", texts: 1 });
    expect(JSON.stringify(store.rows[0])).not.toContain("steam valve");
  });

  it("blocks a numeric text before any call", async () => {
    const store = memoryStore();
    const gateway = createTextGateway({ store, getMode: () => "cloud", resolveEmbedder: () => createHashEmbedder() });
    const result = await gateway.embed(["1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 valve"], "passage");
    expect(result.ok).toBe(false);
    expect(store.rows[0]?.status).toBe("blocked");
  });

  it("returns model off for extraction and logs a local row", async () => {
    const store = memoryStore();
    const gateway = createTextGateway({ store, getMode: () => "off" });
    const result = await gateway.extract({ chunk: "The valve is on dryer 3.", columns: ["xmv_1"], speaker: null });
    expect(result).toEqual({ ok: false, reason: "model off" });
    expect(store.rows[0]).toMatchObject({ purpose: "extract", status: "local" });
  });
});

describe("openai embedder", () => {
  let server: Server;
  let url = "";
  let calls = 0;
  beforeAll(async () => {
    server = createServer((req, res) => {
      let raw = "";
      req.on("data", (c: Buffer) => (raw += c.toString()));
      req.on("end", () => {
        calls++;
        if (calls === 1) {
          res.statusCode = 429;
          res.end("slow down");
          return;
        }
        const input = (JSON.parse(raw) as { input: string[] }).input;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ data: input.map((text, index) => ({ index, embedding: Array.from({ length: 8 }, (_, i) => (i < 4 ? text.length + i : 99)) })) }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/embeddings`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("retries a 429, keeps the first dims, normalizes, and prefixes a query only", { timeout: 15000 }, async () => {
    const embedder = createOpenAiEmbedder({ url, key: "k", model: "m", dims: 4 });
    const [passage] = await embedder.embed(["abc"], "passage");
    expect(calls).toBe(2);
    expect(passage!.length).toBe(4);
    expect(dot(passage!, passage!)).toBeCloseTo(1, 5);
    const [query] = await embedder.embed(["abc"], "query");
    expect(query![0]).not.toBeCloseTo(passage![0]!, 3);
  });
});

describe("transcriber", () => {
  let server: Server;
  let url = "";
  let seen: { key: string | undefined; contentType: string | undefined; body: string } | null = null;
  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        seen = { key: req.headers["xi-api-key"] as string | undefined, contentType: req.headers["content-type"], body: Buffer.concat(chunks).toString("latin1") };
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ language_code: "fi", text: "Venttiili jumittuu.", words: [{ text: "Venttiili", start: 0, end: 0.5, type: "word", speaker_id: "speaker_0" }, { text: " ", start: 0.5, end: 0.6, type: "spacing" }, { text: "jumittuu.", start: 0.6, end: 1.1, type: "word", speaker_id: "speaker_0" }] }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/speech-to-text`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("posts the audio as multipart with the key header and logs a row with the byte count and hash", async () => {
    const store = memoryStore();
    const gateway = createTextGateway({ store, getMode: () => "cloud", resolveTranscriber: () => createElevenLabsTranscriber({ key: "xi", model: "scribe_v1", url }) });
    const audio = Buffer.from("RIFF fake wav bytes");
    const result = await gateway.transcribe({ audio, mediaType: "audio/wav", language: "fi" });
    expect(result.ok && result.value.words.length).toBe(3);
    expect(seen?.key).toBe("xi");
    expect(seen?.contentType).toContain("multipart/form-data");
    expect(seen?.body).toContain('name="model_id"');
    expect(seen?.body).toContain("scribe_v1");
    expect(seen?.body).toContain("RIFF fake wav bytes");
    expect(store.rows[0]).toMatchObject({ purpose: "transcribe", status: "sent", bytes: audio.byteLength, model: "scribe_v1" });
  });

  it("blocks audio in mode off and without a key", async () => {
    const store = memoryStore();
    const off = createTextGateway({ store, getMode: () => "off" });
    expect((await off.transcribe({ audio: Buffer.from("x"), mediaType: "audio/wav", language: null })).ok).toBe(false);
    const noKey = createTextGateway({ store, getMode: () => "cloud", resolveTranscriber: () => null });
    const result = await noKey.transcribe({ audio: Buffer.from("x"), mediaType: "audio/wav", language: null });
    expect(result).toEqual({ ok: false, reason: "TPM_ELEVENLABS_KEY is not set" });
    expect(store.rows.map((r) => r.status)).toEqual(["blocked", "blocked"]);
  });
});

describe("ocr reader", () => {
  let server: Server;
  let url = "";
  let seen: { auth: string | undefined; body: { model: string; messages: { content: { type: string; image_url?: { url: string } }[] }[] } } | null = null;
  beforeAll(async () => {
    server = createServer((req, res) => {
      let raw = "";
      req.on("data", (c: Buffer) => (raw += c.toString()));
      req.on("end", () => {
        seen = { auth: req.headers.authorization, body: JSON.parse(raw) };
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(req.url?.endsWith("/chat/completions") ? { choices: [{ message: { content: " Dryer 3 steam valve\n\nrow one; row two " } }] } : { error: "wrong route" }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("posts the page as a data url to chat completions on the base of the embeddings url and logs a row", async () => {
    const store = memoryStore();
    const gateway = createTextGateway({ store, getMode: () => "cloud", resolveOcr: () => createOpenAiOcr({ url, key: "k", model: "vl" }) });
    const image = Buffer.from("PNG bytes");
    const result = await gateway.ocr({ image, mediaType: "image/png", page: 3 });
    expect(result).toEqual({ ok: true, value: "Dryer 3 steam valve\n\nrow one; row two", source: "model" });
    expect(seen?.auth).toBe("Bearer k");
    expect(seen?.body.model).toBe("vl");
    expect(seen?.body.messages[0]!.content[1]!.image_url!.url).toBe(`data:image/png;base64,${image.toString("base64")}`);
    expect(store.rows[0]).toMatchObject({ purpose: "ocr", status: "sent", bytes: image.byteLength, detail: "page 3, 37 characters" });
    expect(JSON.stringify(store.rows[0])).not.toContain("Dryer");
  });

  it("blocks in mode off", async () => {
    const store = memoryStore();
    const result = await createTextGateway({ store, getMode: () => "off" }).ocr({ image: Buffer.from("x"), mediaType: "image/png", page: 1 });
    expect(result.ok).toBe(false);
    expect(store.rows[0]?.status).toBe("blocked");
  });

  it("derives the chat url from a base url or an embeddings url", () => {
    expect(chatUrl("https://api.featherless.ai/v1")).toBe("https://api.featherless.ai/v1/chat/completions");
    expect(chatUrl("https://api.featherless.ai/v1/embeddings")).toBe("https://api.featherless.ai/v1/chat/completions");
    expect(embeddingsUrl("https://api.featherless.ai/v1/")).toBe("https://api.featherless.ai/v1/embeddings");
  });
});
