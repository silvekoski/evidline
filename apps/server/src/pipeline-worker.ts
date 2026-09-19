import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";
import { loadSource, type Source } from "@tpm/adapters";
import { createMemorySink, minEpisodeLength, runPipeline, type DriftResult, type PipelineResult, type StageCounts } from "@tpm/core";
import type { Evidence, Overrides, StageName } from "@tpm/schemas";

export type PipelineJob = { runId: string; overrides: Overrides; source: { path: string } | Source };
export type PipelineOutput = Omit<PipelineResult, "drifts"> & { drifts: Omit<DriftResult, "model">[] };
export type PipelineJobResult = Source & { evidence: Evidence[]; derived: Map<string, Record<string, Float64Array>>; result: PipelineOutput };
export type StageEvent = { name: StageName; status: "running" | "done"; ms: number | null; counts: StageCounts };

type WorkerMessage = { type: "stage"; event: StageEvent } | { type: "done"; result: PipelineJobResult } | { type: "error"; message: string };

export function runPipelineJob(job: PipelineJob, onStage: (event: StageEvent) => void): Promise<PipelineJobResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./pipeline-worker.ts", import.meta.url), { workerData: job, execArgv: ["--import", import.meta.resolve("tsx")] });
    worker.on("message", (message: WorkerMessage) => {
      if (message.type === "stage") onStage(message.event);
      else if (message.type === "done") resolve(message.result);
      else reject(new Error(message.message));
    });
    worker.on("error", reject);
    worker.on("exit", (code) => {
      if (code !== 0) reject(new Error(`pipeline worker exited with code ${code}`));
    });
  });
}

async function execute(job: PipelineJob, post: (message: WorkerMessage) => void): Promise<void> {
  try {
    const started = Date.now();
    let lastProgress = started;
    const progress = (counts: StageCounts): void => post({ type: "stage", event: { name: "Source adapter", status: "running", ms: null, counts } });
    progress({});
    const onProgress = (rows: number): void => {
      const now = Date.now();
      if (now - lastProgress < 1000) return;
      lastProgress = now;
      progress({ rows });
    };
    const source = "path" in job.source ? await loadSource(job.source.path, { onProgress }) : job.source;
    const { stats } = source;
    const spans = source.grid.episodes.length;
    const counts: StageCounts = { rows: stats.rows, columns: stats.columns, sensors: source.grid.aliases.length, episodes: stats.episodes, spans, quarantined: stats.quarantined.length };
    if (spans < stats.episodes) counts.minEpisode = minEpisodeLength(source.grid.n);
    post({ type: "stage", event: { name: "Source adapter", status: "done", ms: Date.now() - started, counts } });
    const sink = createMemorySink(job.runId);
    const result = runPipeline(source.grid, sink, {
      overrides: job.overrides,
      onStage: (name, ms, counts) => post({ type: "stage", event: { name, status: "done", ms, counts } }),
    });
    post({
      type: "done",
      result: { ...source, evidence: sink.evidence, derived: sink.derived, result: { ...result, drifts: result.drifts.map(({ model: _model, ...drift }) => drift) } },
    });
  } catch (e) {
    post({ type: "error", message: e instanceof Error ? e.message : String(e) });
  }
}

if (!isMainThread && parentPort) {
  const port = parentPort;
  void execute(workerData as PipelineJob, (message) => port.postMessage(message));
}
