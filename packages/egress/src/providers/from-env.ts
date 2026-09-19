import type { ModelMode } from "@tpm/schemas";
import type { Provider } from "../gateway";
import { createAzureProvider } from "./azure";
import { createOllamaProvider } from "./ollama";
import { createOpenAiProvider } from "./openai";

export function getProvider(mode: ModelMode): Provider | null {
  const env = process.env;
  if (mode === "cloud") {
    const url = env.TPM_OPENAI_URL;
    const openAiKey = env.TPM_OPENAI_KEY;
    if (url && openAiKey) {
      return createOpenAiProvider({ url, key: openAiKey, model: env.TPM_OPENAI_MODEL || "default", region: env.TPM_OPENAI_REGION || null });
    }
    const endpoint = env.TPM_AZURE_ENDPOINT;
    const key = env.TPM_AZURE_KEY;
    const deployment = env.TPM_AZURE_DEPLOYMENT;
    if (!endpoint || !key || !deployment) return null;
    return createAzureProvider({ endpoint, key, deployment, region: env.TPM_AZURE_REGION || null });
  }
  if (mode === "local") {
    const host = env.TPM_OLLAMA_HOST;
    const model = env.TPM_OLLAMA_MODEL;
    return host && model ? createOllamaProvider({ host, model }) : null;
  }
  return null;
}
