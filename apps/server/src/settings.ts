import type { Gateway } from "@tpm/egress";
import { ModelMode, type ModelSettings } from "@tpm/schemas";
import type { Db } from "./db";

export type ModelCallsHook = (runId: string) => Promise<unknown>;

const modeKey = "model-mode";
let modelCallsHook: ModelCallsHook | null = null;

export function registerModelCallsHook(hook: ModelCallsHook): void {
  modelCallsHook = hook;
}

export const getModelMode = (db: Db): ModelMode => ModelMode.safeParse(db.settings.get(modeKey)).data ?? "off";

export function getModelSettings(db: Db, gateway: Gateway): ModelSettings {
  const mode = getModelMode(db);
  return { mode, provider: gateway.provider(mode) };
}

export function setModelMode(db: Db, gateway: Gateway, mode: ModelMode): ModelSettings {
  db.settings.set(modeKey, mode);
  const runId = mode === "off" ? null : db.egress.newestOffRunId();
  if (runId !== null && modelCallsHook) {
    modelCallsHook(runId).catch((e: unknown) => console.error(`model calls for run ${runId} failed:`, e));
  }
  return getModelSettings(db, gateway);
}
