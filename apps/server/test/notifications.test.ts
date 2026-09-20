import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationList, type DriftInference, type HealthInference, type Inference } from "@tpm/schemas";
import { getNotificationSettings, notify, runFailed, runFinished, sensorAlert } from "../src/notifications";
import { fixture, run, type Fixture } from "./fixture";

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

describe("sensorAlert", () => {
  it("returns null when every sensor is healthy and no drift is flagged", () => {
    const inferences: Inference[] = [health("T-101", 1, "healthy"), drift("T-101", 2, false)];
    expect(sensorAlert(run("0123abcd"), inferences)).toBeNull();
  });

  it("lists each failed health check and each flagged drift", () => {
    const inferences: Inference[] = [health("T-101", 1, "stuck"), health("T-102", 2, "healthy"), drift("T-103", 3, true)];
    const alert = sensorAlert(run("0123abcd", { name: "line-3.csv" }), inferences);
    expect(alert).toEqual({ kind: "sensor-alert", title: "line-3.csv: 2 sensors out of range", message: "T-101: health stuck\nT-103: drift, rate 1.23 per 1000 steps", runId: "0123abcd" });
  });

  it("builds the run finished and run failed drafts", () => {
    expect(runFinished(run("0123abcd"), 61_500)).toMatchObject({ kind: "run-finished", title: "demo-stream.csv: run finished", message: "52 sensors, 20000 steps, 62 s" });
    expect(runFailed(run("0123abcd"), "boom")).toEqual({ kind: "run-failed", title: "demo-stream.csv: run failed", message: "boom", runId: "0123abcd" });
  });
});

const fakeFetchResponse = (status: number, text: string) => ({ status, headers: { forEach: () => {} }, arrayBuffer: async () => new TextEncoder().encode(text).buffer, text: async () => text });
const draft = { kind: "sensor-alert" as const, title: "line-3.csv: 1 sensor out of range", message: "T-101: health stuck", runId: "0123abcd" };
const json = (body: unknown): RequestInit => ({ method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("notify", () => {
  const env = { ...process.env };
  let f: Fixture;
  beforeEach(() => {
    f = fixture();
    process.env.RESEND_API_KEY = "re_123";
    process.env.ALERT_FROM = "alerts@example.com";
    process.env.ALERT_TO = "ops@example.com, lead@example.com";
    process.env.APP_URL = "https://plant.example/";
  });
  afterEach(() => {
    process.env = { ...env };
    vi.unstubAllGlobals();
    f.close();
  });

  it("stores the notification without an email when the key is missing", async () => {
    delete process.env.RESEND_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const stored = await notify(f.ctx, draft);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(stored).toMatchObject({ ...draft, readAt: null, email: "off", emailId: null, emailError: null });
    expect(f.ctx.db.notifications.list()).toEqual([stored]);
    expect(getNotificationSettings(f.ctx.db)).toEqual({ email: { "sensor-alert": true, "run-finished": false, "run-failed": true }, emailConfigured: false, recipients: [] });
  });

  it("emails the notification through resend with a link to the run screen", async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeFetchResponse(200, '{"id":"abc"}'));
    vi.stubGlobal("fetch", fetchMock);
    const stored = await notify(f.ctx, draft);
    expect(stored).toMatchObject({ email: "sent", emailId: "abc", emailError: null });
    expect(fetchMock).toHaveBeenCalledWith("https://api.resend.com/emails", expect.objectContaining({ method: "POST", headers: expect.objectContaining({ Authorization: "Bearer re_123" }) }));
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body).toMatchObject({
      from: "alerts@example.com",
      to: ["ops@example.com", "lead@example.com"],
      subject: "line-3.csv: 1 sensor out of range",
      text: expect.stringMatching(/^T-101: health stuck\n\nOpen the run: https:\/\/plant\.example\/w\/norrin\/runs\/0123abcd\/quality\n\n/),
      attachments: [{ filename: "evidline-logo.png", content_id: "evidline-logo", content: expect.stringMatching(/^iVBOR/) }],
    });
    expect(body.html).toContain('<img src="cid:evidline-logo"');
    expect(body.html).toContain('href="https://plant.example/w/norrin/runs/0123abcd/quality"');
    expect(body.html).toContain("T-101: health stuck");
    expect(body.text).toContain(`notification: ${stored.id}\nkind: sensor-alert\nrun: 0123abcd\nworkspace: norrin\nhost: `);
    expect(body.html).toContain(`notification: ${stored.id}<br>kind: sensor-alert<br>run: 0123abcd<br>workspace: norrin`);
  });

  it("records a failed email and logs a line", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fakeFetchResponse(403, "forbidden")));
    const lines: string[] = [];
    const stored = await notify({ ...f.ctx, log: (line) => lines.push(line) }, draft);
    expect(stored).toMatchObject({ email: "failed", emailId: null, emailError: "403 forbidden" });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(new RegExp(`^email failed ref=${stored.id} from=alerts@example.com to=ops@example.com,lead@example.com subject="line-3.csv: 1 sensor out of range" bytes=\\d+ error="403 forbidden" \\d+ ms$`));
  });

  it("skips the email for a kind that is off in the settings", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await f.app.request("/api/settings/notifications", json({ email: { "sensor-alert": false } }));
    expect(await res.json()).toMatchObject({ email: { "sensor-alert": false, "run-finished": false, "run-failed": true }, emailConfigured: true, recipients: ["ops@example.com", "lead@example.com"] });
    const lines: string[] = [];
    expect((await notify({ ...f.ctx, log: (line) => lines.push(line) }, draft)).email).toBe("off");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(lines[0]).toMatch(/^email off ref=ntf-\w+ kind=sensor-alert configured=true enabled=false$/);
  });
});

describe("notification routes", () => {
  let f: Fixture;
  beforeEach(() => {
    f = fixture();
    delete process.env.RESEND_API_KEY;
  });
  afterEach(() => f.close());

  it("lists, marks one read, and marks all read", async () => {
    const first = await notify(f.ctx, draft);
    const second = await notify(f.ctx, runFailed(run("0123abcd"), "boom"));
    const list = NotificationList.parse(await (await f.app.request("/api/notifications")).json());
    expect(list.map((n) => n.id)).toEqual([second.id, first.id]);
    const read = await f.app.request(`/api/notifications/${first.id}/read`, { method: "POST" });
    expect(await read.json()).toMatchObject({ id: first.id, readAt: expect.any(String) });
    expect(NotificationList.parse(await (await f.app.request("/api/notifications")).json()).filter((n) => n.readAt === null)).toHaveLength(1);
    expect(await (await f.app.request("/api/notifications/read-all", { method: "POST" })).json()).toEqual({ read: 1 });
    expect(NotificationList.parse(await (await f.app.request("/api/notifications")).json()).every((n) => n.readAt !== null)).toBe(true);
    expect((await f.app.request("/api/notifications/ntf-missing/read", { method: "POST" })).status).toBe(404);
  });

  it("reports a missing email setup from the test route", async () => {
    const res = await f.app.request("/api/settings/notifications/test", { method: "POST" });
    expect(await res.json()).toEqual({ email: "off", emailId: null, emailError: "RESEND_API_KEY, ALERT_FROM or ALERT_TO is not set" });
  });

  it("rejects an unknown kind in the settings body", async () => {
    const res = await f.app.request("/api/settings/notifications", json({ email: { pager: true } }));
    expect(res.status).toBe(400);
  });
});
