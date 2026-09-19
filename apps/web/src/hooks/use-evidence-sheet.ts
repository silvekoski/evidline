import { useSyncExternalStore } from "react";

let current: string | null = null;
const listeners = new Set<() => void>();

function set(id: string | null) {
  current = id;
  for (const listener of listeners) listener();
}

export const openEvidence = (id: string) => set(id);
export const closeEvidence = () => set(null);

export function useEvidenceSheet(): string | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}
