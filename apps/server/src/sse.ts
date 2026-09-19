import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { Run, RunEvent } from "@tpm/schemas";

export type RunListener = (event: RunEvent) => void;
export type RunHub = {
  publish(runId: string, event: RunEvent): void;
  subscribe(runId: string, listener: RunListener): () => void;
};

export function createHub(getRun: (runId: string) => Run | null): RunHub {
  const channels = new Map<string, Set<RunListener>>();
  return {
    publish(runId, event) {
      const listeners = channels.get(runId);
      if (!listeners) return;
      for (const listener of listeners) listener(event);
      if (event.type === "done") channels.delete(runId);
    },
    subscribe(runId, listener) {
      const run = getRun(runId);
      if (run !== null && (run.status === "done" || run.status === "failed")) {
        listener({ type: "run", run });
        listener({ type: "done", runId });
        return () => {};
      }
      const listeners = channels.get(runId) ?? new Set<RunListener>();
      channels.set(runId, listeners);
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && channels.get(runId) === listeners) channels.delete(runId);
      };
    },
  };
}

export function sseResponse(c: Context, hub: RunHub, runId: string): Response {
  return streamSSE(
    c,
    (stream) =>
      new Promise<void>((resolve) => {
        let queue = Promise.resolve();
        const unsubscribe = hub.subscribe(runId, (event) => {
          queue = queue.then(() => stream.writeSSE({ data: JSON.stringify(event) }));
          if (event.type === "done") void queue.then(resolve);
        });
        stream.onAbort(() => {
          unsubscribe();
          resolve();
        });
      }),
  );
}
