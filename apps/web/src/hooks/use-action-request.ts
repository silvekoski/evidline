import { useSyncExternalStore } from "react";
import type { OverrideValue } from "@tpm/schemas";

export type ActionRequest =
  | { inferenceId: string; kind: "question"; text: string }
  | { inferenceId: string; kind: "override"; value: OverrideValue; reason: string };

let current: ActionRequest | null = null;
const listeners = new Set<() => void>();

export function requestAction(request: ActionRequest | null): void {
  current = request;
  for (const listener of listeners) listener();
}

export function useActionRequest(inferenceId: string, kind: ActionRequest["kind"]): ActionRequest | null {
  const request = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
  return request?.inferenceId === inferenceId && request.kind === kind ? request : null;
}
