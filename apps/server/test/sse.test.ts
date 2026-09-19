import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { Run, RunEvent } from "@tpm/schemas";
import { createHub, sseResponse } from "../src/sse";
import { run } from "./fixture";

const runs = new Map<string, Run>();
const hub = createHub((id) => runs.get(id) ?? null);

describe("sse hub", () => {
  it("delivers live events and drops the channel on done", () => {
    runs.set("aaaa0000", run("aaaa0000", { status: "running" }));
    const seen: RunEvent[] = [];
    const unsubscribe = hub.subscribe("aaaa0000", (e) => seen.push(e));
    hub.publish("aaaa0000", { type: "stage", stage: { stage: 1, name: "Fingerprint", status: "done", ms: 5, counts: {} } });
    hub.publish("aaaa0000", { type: "done", runId: "aaaa0000" });
    hub.publish("aaaa0000", { type: "error", message: "late" });
    unsubscribe();
    expect(seen.map((e) => e.type)).toEqual(["stage", "done"]);
  });

  it("replays the final run and done to a late subscriber", () => {
    runs.set("bbbb0000", run("bbbb0000"));
    const seen: RunEvent[] = [];
    hub.subscribe("bbbb0000", (e) => seen.push(e));
    expect(seen).toEqual([
      { type: "run", run: runs.get("bbbb0000") },
      { type: "done", runId: "bbbb0000" },
    ]);
  });

  it("streams each event as one default message", async () => {
    runs.set("cccc0000", run("cccc0000", { status: "failed", error: "boom" }));
    const app = new Hono().get("/runs/:id/events", (c) => sseResponse(c, hub, c.req.param("id")));
    const res = await app.request("/runs/cccc0000/events");
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text();
    expect(text).not.toContain("event:");
    expect(text).toMatch(/^data: \{"type":"run","run":\{.*"status":"failed".*\}\}\n\n/);
    expect(text.endsWith('data: {"type":"done","runId":"cccc0000"}\n\n')).toBe(true);
  });
});
