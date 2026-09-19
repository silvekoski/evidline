import type { Job, JobType, WorkspaceSlug } from "@tpm/schemas";
import type { AppContext } from "./context";
import { connectorSync, renewSubscriptions } from "./connector-service";
import { jobHandlers as corpusHandlers } from "./corpus-service";

const jobHandlers: Partial<Record<JobType, JobHandler>> = { ...corpusHandlers, "connector-sync": connectorSync, "renew-subscriptions": renewSubscriptions };
import type { Registry } from "./registry";

export type EnqueueOptions = { runAfter?: string; dedupe?: string };
export type Resolve = (workspace: WorkspaceSlug | null) => AppContext;
export type JobHandler = (ctx: AppContext, payload: Record<string, unknown>, job: Job, resolve: Resolve) => Promise<void>;

export type JobRunner = {
  enqueue(workspace: WorkspaceSlug | null, type: JobType, payload: Record<string, unknown>, opts?: EnqueueOptions): number | null;
  runPending(): Promise<number>;
  start(intervalMs?: number): void;
  stop(): void;
};

export type JobRunnerOptions = {
  registry: Registry;
  resolve: Resolve;
  handlers?: Partial<Record<JobType, JobHandler>>;
  log: (line: string) => void;
};

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function createJobRunner(opts: JobRunnerOptions): JobRunner {
  const handlers: Partial<Record<JobType, JobHandler>> = opts.handlers ?? jobHandlers;
  let timer: NodeJS.Timeout | null = null;
  let running: Promise<number> | null = null;

  async function runOne(job: Job): Promise<void> {
    const handler = handlers[job.type];
    try {
      if (!handler) throw new Error(`no handler for job type ${job.type}`);
      await handler(opts.resolve(job.workspace), job.payload, job, opts.resolve);
      opts.registry.jobs.done(job.id);
    } catch (e) {
      opts.registry.jobs.fail(job, message(e));
      opts.log(`job ${job.id} ${job.type} failed (try ${job.attempts}): ${message(e)}`);
    }
  }

  const runPending = (): Promise<number> => {
    if (running) return running;
    running = (async () => {
      let count = 0;
      for (let job = opts.registry.jobs.claim(); job !== null; job = opts.registry.jobs.claim()) {
        await runOne(job);
        count++;
      }
      return count;
    })().finally(() => {
      running = null;
    });
    return running;
  };

  return {
    enqueue: (workspace, type, payload, o) => opts.registry.jobs.enqueue(workspace, type, payload, o),
    runPending,
    start(intervalMs = 1000) {
      if (timer) return;
      opts.registry.jobs.resetRunning();
      timer = setInterval(() => void runPending().catch((e) => opts.log(`job loop failed: ${message(e)}`)), intervalMs);
      timer.unref();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
