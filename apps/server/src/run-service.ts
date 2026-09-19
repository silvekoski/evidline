import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { Source } from "@tpm/adapters";
import { stageNames, type Overrides, type Run, type StageName, type StageProgress } from "@tpm/schemas";
import type { AppContext } from "./context";
import { newRunId } from "./ids";
import { appendLog } from "./log";
import { runModelCalls } from "./model-calls";
import { repoRoot } from "./paths";
import { persistRun } from "./persist";
import { runPipelineJob } from "./pipeline-worker";

export type RunInput = ({ path: string } | { source: Source; name: string }) & { parentRunId?: string; overrides?: Overrides };

const commitHash = ((): string => {
  try {
    const head = readFileSync(join(repoRoot, ".git", "HEAD"), "utf8").trim();
    if (!head.startsWith("ref: ")) return head;
    const ref = head.slice(5);
    const direct = join(repoRoot, ".git", ref);
    if (existsSync(direct)) return readFileSync(direct, "utf8").trim();
    const packed = readFileSync(join(repoRoot, ".git", "packed-refs"), "utf8");
    return packed.split("\n").find((line) => line.endsWith(` ${ref}`))?.split(" ")[0] ?? "unknown";
  } catch {
    return "unknown";
  }
})();

let queue: Promise<unknown> = Promise.resolve();

export function startRun(ctx: AppContext, input: RunInput): { run: Run; done: Promise<Run> } {
  const templates = ctx.gateway.templates();
  const run: Run = {
    id: newRunId(),
    name: "path" in input ? basename(input.path) : input.name,
    domain: "stream",
    status: "queued",
    createdAt: new Date().toISOString(),
    finishedAt: null,
    rows: 0,
    columns: 0,
    sensorCount: 0,
    quarantined: [],
    episodes: 0,
    rawBytes: 0,
    gridSize: 0,
    bucket: 1,
    timeBase: { t0: null, dt: null, n: 0 },
    commitHash,
    templateHashes: { name_role: templates.name_role.hash, compile_rule: templates.compile_rule.hash, explain_diagnosis: templates.explain_diagnosis.hash, plan_investigation: templates.plan_investigation.hash },
    stages: stageNames.map((name, stage) => ({ stage, name, status: "pending", ms: null, counts: {} })),
    error: null,
    parentRunId: input.parentRunId ?? null,
  };
  ctx.db.runs.save(run);
  ctx.hub.publish(run.id, { type: "run", run });
  const done = queue.then(() => execute(ctx, run, input));
  queue = done.catch(() => {});
  return { run, done };
}

async function execute(ctx: AppContext, initial: Run, input: RunInput): Promise<Run> {
  const { db, hub } = ctx;
  let run = initial;
  const save = (patch: Partial<Run>): void => {
    run = { ...run, ...patch };
    db.runs.save(run);
    hub.publish(run.id, { type: "run", run });
  };
  const stage = (name: StageName, patch: Partial<StageProgress>): void => {
    const index = stageNames.indexOf(name);
    const progress = { ...run.stages[index]!, ...patch };
    run = { ...run, stages: run.stages.with(index, progress) };
    db.runs.save(run);
    hub.publish(run.id, { type: "stage", stage: progress });
  };
  const log = (type: "run-started" | "rerun" | "run-finished", after: unknown, reason: string | null = null): void => {
    appendLog(db, { type, actor: "agent", runId: run.id, inferenceId: null, evidenceIds: [], egressId: null, before: null, after, reason });
  };
  try {
    save({ status: "running" });
    log(run.parentRunId === null ? "run-started" : "rerun", { name: run.name, parentRunId: run.parentRunId, overrides: input.overrides ?? {} });
    const job = { runId: run.id, overrides: input.overrides ?? {}, source: "path" in input ? { path: input.path } : input.source };
    const output = await runPipelineJob(job, (event) => stage(event.name, { status: event.status, ms: event.ms, counts: event.counts }));
    run = persistRun(db, run, output).run;
    stage("Model calls", { status: "running" });
    const started = Date.now();
    await runModelCalls(ctx, run.id);
    const records = db.egress.list(run.id);
    stage("Model calls", { status: "done", ms: Date.now() - started, counts: { calls: records.length, sent: records.filter((r) => r.status === "sent").length } });
    const finishedAt = new Date().toISOString();
    log("run-finished", { status: "done", ms: Date.parse(finishedAt) - Date.parse(run.createdAt), sensors: run.sensorCount, gridSize: run.gridSize });
    save({ status: "done", finishedAt });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const running = run.stages.find((s) => s.status === "running");
    if (running) stage(running.name as StageName, { status: "failed" });
    log("run-finished", { status: "failed" }, message);
    save({ status: "failed", error: message, finishedAt: new Date().toISOString() });
    hub.publish(run.id, { type: "error", message });
  }
  hub.publish(run.id, { type: "done", runId: run.id });
  return run;
}
