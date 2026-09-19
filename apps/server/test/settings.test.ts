import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ModelSettings } from "@tpm/schemas";
import { registerModelCallsHook } from "../src/settings";
import { egressRecord, fixture, run, type Fixture } from "./fixture";

const put = (f: Fixture, body: unknown) =>
  f.app.request("/api/settings/model", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("model settings", () => {
  let f: Fixture;
  beforeEach(() => {
    f = fixture();
  });
  afterEach(() => {
    registerModelCallsHook(() => Promise.resolve());
    f.close();
  });

  it("defaults to off with no provider", async () => {
    const res = await f.app.request("/api/settings/model");
    expect(res.status).toBe(200);
    expect(ModelSettings.parse(await res.json())).toEqual({ mode: "off", provider: null });
  });

  it("changes the mode with PUT and keeps it", async () => {
    const res = await put(f, { mode: "local" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ mode: "local", provider: null });
    expect(await (await f.app.request("/api/settings/model")).json()).toMatchObject({ mode: "local" });
    expect(await (await put(f, { mode: "off" })).json()).toEqual({ mode: "off", provider: null });
  });

  it("rejects an unknown mode", async () => {
    const res = await put(f, { mode: "remote" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("mode");
  });

  it("calls the model-calls hook for the newest run whose records are off", async () => {
    f.ctx.db.runs.save(run("0123abcd", { createdAt: "2026-09-19T09:00:00.000Z" }));
    f.ctx.db.runs.save(run("89abcdef", { createdAt: "2026-09-19T11:00:00.000Z" }));
    f.ctx.db.runs.save(run("deadbeef", { createdAt: "2026-09-19T12:00:00.000Z" }));
    f.ctx.db.egress.save(egressRecord("eg-1", "0123abcd", "off"));
    f.ctx.db.egress.save(egressRecord("eg-2", "89abcdef", "off"));
    f.ctx.db.egress.save(egressRecord("eg-3", "deadbeef", "off"));
    f.ctx.db.egress.save(egressRecord("eg-4", "deadbeef", "sent"));
    const calls: string[] = [];
    registerModelCallsHook(async (runId) => {
      calls.push(runId);
    });
    await put(f, { mode: "cloud" });
    await put(f, { mode: "off" });
    expect(calls).toEqual(["89abcdef"]);
  });
});
