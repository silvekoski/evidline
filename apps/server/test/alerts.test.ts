import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DriftInference, HealthInference, Inference } from "@tpm/schemas";
import { runAlert, sendAlert, sendRunAlert } from "../src/alerts";
import { run } from "./fixture";

const evidenceId = "ev-0123abcd-00001";
const base = { runId: "0123abcd", claim: "x", confidence: 0.9, evidenceIds: [evidenceId], status: "proposed" as const, supersedes: null };

const health = (sensor: string, seq: number, healthValue: HealthInference["value"]["health"]): HealthInference => ({
  ...base,
  id: `inf-0123abcd-${String(seq).padStart(5, "0")}`,
  seq,
  sensor,
  stage: "health",
  value: { sensor, health: healthValue, masked: [], checks: [] },
});

const drift = (sensor: string, seq: number, drifting: boolean): DriftInference => ({
  ...base,
  id: `inf-0123abcd-${String(seq).padStart(5, "0")}`,
  seq,
  sensor,
  stage: "drift",
  value: { sensor, method: "peer-residual", peers: [], onset: null, ratePer1000: 1.2345, mannKendallZ: 3, pValue: 0.01, severity: 0.5, maxDeviation: 1, drifting, inRange: true, responsible: null, detectionDelay: null },
});

describe("runAlert", () => {
  it("returns null when every sensor is healthy and no drift is flagged", () => {
    const inferences: Inference[] = [health("T-101", 1, "healthy"), drift("T-101", 2, false)];
    expect(runAlert(run("0123abcd"), inferences)).toBeNull();
  });

  it("lists each failed health check and each flagged drift", () => {
    const inferences: Inference[] = [health("T-101", 1, "stuck"), health("T-102", 2, "healthy"), drift("T-103", 3, true)];
    const alert = runAlert(run("0123abcd", { name: "line-3.csv" }), inferences);
    expect(alert?.title).toBe("line-3.csv: 2 sensors out of range");
    expect(alert?.message).toBe("T-101: health stuck\nT-103: drift, rate 1.23 per 1000 steps");
  });
});

const fakeFetchResponse = (status: number, text: string) => ({ status, headers: { forEach: () => {} }, arrayBuffer: async () => new TextEncoder().encode(text).buffer, text: async () => text });

describe("sendAlert", () => {
  const env = { ...process.env };
  beforeEach(() => {
    process.env.RESEND_API_KEY = "re_123";
    process.env.ALERT_FROM = "alerts@example.com";
    process.env.ALERT_TO = "ops@example.com, lead@example.com";
  });
  afterEach(() => {
    process.env = { ...env };
    vi.unstubAllGlobals();
  });

  it("does nothing without an api key", async () => {
    delete process.env.RESEND_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await sendAlert({ title: "t", message: "m" }, () => {});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("emails the alert through resend to each configured recipient", async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeFetchResponse(200, '{"id":"abc"}'));
    vi.stubGlobal("fetch", fetchMock);
    await sendAlert({ title: "line-3.csv: 1 sensor out of range", message: "T-101: health stuck" }, () => {});
    expect(fetchMock).toHaveBeenCalledWith("https://api.resend.com/emails", expect.objectContaining({ method: "POST", headers: expect.objectContaining({ Authorization: "Bearer re_123" }) }));
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ from: "alerts@example.com", to: ["ops@example.com", "lead@example.com"], subject: "line-3.csv: 1 sensor out of range", text: "T-101: health stuck" });
  });

  it("logs a line when resend answers with an error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeFetchResponse(403, "forbidden"));
    vi.stubGlobal("fetch", fetchMock);
    const log = vi.fn();
    await sendAlert({ title: "t", message: "m" }, log);
    expect(log).toHaveBeenCalledWith("resend alert failed: 403 forbidden");
  });

  it("sends nothing through sendRunAlert when the run has no flagged sensor", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await sendRunAlert(run("0123abcd"), [health("T-101", 1, "healthy")], () => {});
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
