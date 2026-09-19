import { getProvider } from "@tpm/egress";
import { ModelMode, type ModelSettings } from "@tpm/schemas";
import type { Db } from "./db";

export type ModelCallsHook = (runId: string) => Promise<void>;

const modeKey = "model-mode";
let modelCallsHook: ModelCallsHook | null = null;

export function registerModelCallsHook(hook: ModelCallsHook): void {
  modelCallsHook = hook;
}

export function getModelSettings(db: Db): ModelSettings {
  const mode = ModelMode.safeParse(db.settings.get(modeKey)).data ?? "off";
  const provider = getProvider(mode);
  return { mode, provider: provider ? { name: provider.name, model: provider.model, region: provider.region, host: provider.host } : null };
}

export function setModelMode(db: Db, mode: ModelMode): ModelSettings {
  db.settings.set(modeKey, mode);
  const runId = mode === "off" ? null : db.egress.newestOffRunId();
  if (runId !== null && modelCallsHook) {
    modelCallsHook(runId).catch((e: unknown) => console.error(`model calls for run ${runId} failed:`, e));
  }
  return getModelSettings(db);
}
