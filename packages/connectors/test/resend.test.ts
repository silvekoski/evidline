import { describe, expect, it } from "vitest";
import { sendResendAlert } from "../src/index";
import type { Transport } from "../src/types";

const config = { apiKey: "re_123", from: "alerts@example.com", to: ["ops@example.com", "lead@example.com"] };

describe("resend alert", () => {
  it("posts the alert as a plain text email with the api key", async () => {
    const calls: Parameters<Transport>[] = [];
    const transport: Transport = async (url, init) => {
      calls.push([url, init]);
      return { status: 200, headers: {}, text: '{"id":"abc"}', bytes: async () => Buffer.alloc(0) };
    };
    const result = await sendResendAlert(transport, config, { title: "line-3: 1 sensor out of range", message: "T-101: health stuck" });
    expect(result).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toBe("https://api.resend.com/emails");
    expect(calls[0]![1]).toMatchObject({ method: "POST", headers: { Authorization: "Bearer re_123", "Content-Type": "application/json" } });
    expect(JSON.parse(calls[0]![1]!.body!)).toEqual({ from: "alerts@example.com", to: ["ops@example.com", "lead@example.com"], subject: "line-3: 1 sensor out of range", text: "T-101: health stuck" });
  });

  it("reports a non-2xx response as an error", async () => {
    const transport: Transport = async () => ({ status: 403, headers: {}, text: "forbidden", bytes: async () => Buffer.alloc(0) });
    const result = await sendResendAlert(transport, config, { title: "t", message: "m" });
    expect(result).toEqual({ ok: false, error: "403 forbidden" });
  });
});
