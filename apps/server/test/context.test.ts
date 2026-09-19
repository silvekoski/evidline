import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { createContext, type AppContext } from "../src/context";
import { listLog, verifyLog } from "../src/log";
import { run } from "./fixture";

describe("startup", () => {
  let dir: string;
  let ctx: AppContext;
  const open = (): AppContext => createContext({ dbPath: join(dir, "tpm.db"), dataDir: join(dir, "data"), webDist: null, log: () => {} });
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "tpm-context-"));
    ctx = open();
  });
  afterEach(() => {
    ctx.db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("fails the runs that a restart interrupted and ends their event stream", async () => {
    const stages = [{ stage: 0, name: "Source adapter", status: "done" as const, ms: 5, counts: {} }, { stage: 1, name: "Fingerprint", status: "running" as const, ms: null, counts: {} }];
    ctx.db.runs.save(run("aaaa0001", { status: "running", finishedAt: null, stages }));
    ctx.db.runs.save(run("aaaa0002", { status: "queued", finishedAt: null }));
    ctx.db.runs.save(run("aaaa0003"));
    ctx.db.close();
    ctx = open();
    expect(ctx.db.runs.get("aaaa0001")).toMatchObject({ status: "failed", error: "server restarted", stages: [{ status: "done" }, { status: "failed" }] });
    expect(ctx.db.runs.get("aaaa0001")?.finishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(ctx.db.runs.get("aaaa0002")).toMatchObject({ status: "failed", error: "server restarted" });
    expect(ctx.db.runs.get("aaaa0003")).toMatchObject({ status: "done", error: null });
    expect(listLog(ctx.db).map((e) => [e.runId, e.type, e.reason]).sort()).toEqual([["aaaa0001", "run-finished", "server restarted"], ["aaaa0002", "run-finished", "server restarted"]]);
    expect(verifyLog(ctx.db).ok).toBe(true);
    const text = await (await createApp(ctx).request("/api/runs/aaaa0001/events")).text();
    expect(text.endsWith('data: {"type":"done","runId":"aaaa0001"}\n\n')).toBe(true);
  });
});
