import { describe, expect, it } from "vitest";
import { createOpenAiProvider } from "../src/providers/openai";
import type { Transport } from "../src/providers/transport";
import { getReviewers } from "../src/providers/from-env";
import { replies, reviewPayload, testGateway } from "./fixtures";

const ctx = { runId: "0123abcd", inferenceId: null, operatorText: false };
const completion = (content: string, finish = "stop") => JSON.stringify({ choices: [{ message: { role: "assistant", content }, finish_reason: finish }] });

function transportOf(responses: { status: number; text: string; headers?: Record<string, string> }[]) {
  const requests: { url: string; body: Record<string, unknown>; timeoutMs: number | undefined }[] = [];
  const transport: Transport = async (url, init) => {
    requests.push({ url, body: JSON.parse(init.body) as Record<string, unknown>, timeoutMs: init.timeoutMs });
    return responses.shift() ?? { status: 500, text: "no response" };
  };
  return { transport, requests };
}

describe("openai-compatible provider without structured output", () => {
  it("sends no response_format, caps max_tokens, turns thinking off and allows two minutes", async () => {
    const { transport, requests } = transportOf([{ status: 200, text: completion(`<think>hmm</think>${replies.cross_review}`) }]);
    const provider = createOpenAiProvider({ url: "https://review.example/v1/chat/completions", key: "k", model: "m", region: null, structured: false, transport });
    const { gateway } = testGateway({ mode: "cloud", provider });
    const result = await gateway.call<{ faultClass: string }>("cross_review", reviewPayload, ctx);
    expect(result).toMatchObject({ ok: true, value: { faultClass: "sensor-dead" } });
    const request = requests[0]!;
    expect(request.body.response_format).toBeUndefined();
    expect(request.body.max_tokens).toBe(4096);
    expect(request.body.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(request.body.temperature).toBe(0);
    expect(request.timeoutMs).toBe(120_000);
  });

  it("waits for Retry-After on a 429 and retries once", async () => {
    const { transport, requests } = transportOf([
      { status: 429, text: "busy", headers: { "retry-after": "0" } },
      { status: 200, text: completion(replies.cross_review as string) },
    ]);
    const provider = createOpenAiProvider({ url: "https://review.example/v1/chat/completions", key: "k", model: "m", region: null, structured: false, transport });
    const { gateway, store } = testGateway({ mode: "cloud", provider });
    const result = await gateway.call("cross_review", reviewPayload, ctx);
    expect(result.ok).toBe(true);
    expect(requests).toHaveLength(2);
    expect(store.records[0]?.status).toBe("sent");
  });

  it("reports a reply that hit max_tokens as an error", async () => {
    const { transport } = transportOf([{ status: 200, text: completion("<think>still thinking", "length") }]);
    const provider = createOpenAiProvider({ url: "https://review.example/v1/chat/completions", key: "k", model: "m", region: null, structured: false, transport });
    const { gateway, store } = testGateway({ mode: "cloud", provider });
    const result = await gateway.call("cross_review", reviewPayload, ctx);
    expect(result.ok === false && result.reason).toContain("truncated at max_tokens");
    expect(store.records[0]?.status).toBe("error");
  });
});

describe("getReviewers from the environment", () => {
  const keys = ["TPM_REVIEW_KEY", "TPM_REVIEW_URL", "TPM_REVIEW_MODELS", "TPM_REVIEW_REGION"];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const restore = () => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  };

  it("returns no reviewer without a key and one openai-compatible provider per model with it", () => {
    for (const k of keys) delete process.env[k];
    expect(getReviewers()).toEqual([]);
    process.env.TPM_REVIEW_KEY = "k";
    expect(getReviewers().map((p) => p.host)).toEqual(Array(4).fill("api.featherless.ai"));
    process.env.TPM_REVIEW_MODELS = " a/one, b/two ,";
    process.env.TPM_REVIEW_URL = "https://other.example/v1/chat/completions";
    expect(getReviewers().map((p) => [p.name, p.model, p.host])).toEqual([
      ["openai-compatible", "a/one", "other.example"],
      ["openai-compatible", "b/two", "other.example"],
    ]);
    restore();
  });
});
