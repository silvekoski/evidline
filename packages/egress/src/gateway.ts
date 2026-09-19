import type { ZodType } from "zod";
import type { EgressPayload, EgressRecord, GuardResult, ModelMode, ProviderInfo, Purpose, TemplateInfo } from "@tpm/schemas";
import { fallback, fallbackMissingReason } from "./fallback";
import { issueSummary, payloadGuards, recordGuard } from "./guards";
import type { LeakIndex } from "./leak";
import { getProvider } from "./providers/from-env";
import { roundPayload } from "./round";
import { responseSchema, templates } from "./templates";

export type Provider = ProviderInfo & { call(payloadText: string, template: string, schema: ZodType): Promise<string> };
export type EgressStore = { write(record: EgressRecord): void; update(id: string, patch: Partial<EgressRecord>): void };

export type CallContext = { runId: string | null; inferenceId: string | null; operatorText: boolean };
export type CallResult<T> =
  { ok: true; value: T; recordId: string; source: "model" | "fallback" } | { ok: false; recordId: string | null; reason: string };

export type Gateway = {
  call<T>(purpose: Purpose, payload: EgressPayload, ctx: CallContext): Promise<CallResult<T>>;
  provider(mode: ModelMode): ProviderInfo | null;
  templates(): TemplateInfo;
};

export type GatewayOptions = {
  store: EgressStore;
  getMode: () => ModelMode;
  leakIndex: (runId: string | null) => LeakIndex;
  nowIso: () => string;
  newId: () => string;
  resolveProvider?: (mode: ModelMode) => Provider | null;
};

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const noProviderMessage = (mode: ModelMode) => `no provider configured for mode ${mode}`;
const infoOf = ({ name, model, region, host }: Provider): ProviderInfo => ({ name, model, region, host });

export function createGateway(opts: GatewayOptions): Gateway {
  const resolve = opts.resolveProvider ?? getProvider;
  const providerFor = (mode: ModelMode): Provider | null => (mode === "off" ? null : resolve(mode));
  return {
    templates: () => templates(),
    provider(mode) {
      const provider = providerFor(mode);
      return provider === null ? null : infoOf(provider);
    },
    async call<T>(purpose: Purpose, payload: EgressPayload, ctx: CallContext): Promise<CallResult<T>> {
      const mode = opts.getMode();
      const provider = providerFor(mode);
      const text = JSON.stringify(roundPayload(payload));
      const input = { purpose, payload, text, index: opts.leakIndex(ctx.runId) };
      const guards: GuardResult[] = [];
      for (const guard of payloadGuards) {
        const result = guard(input);
        guards.push(result);
        if (!result.pass) break;
      }
      const failed = guards.find((g) => !g.pass);
      const missingProvider = mode !== "off" && provider === null;
      const id = opts.newId();
      const record: EgressRecord = {
        id,
        runId: ctx.runId,
        time: opts.nowIso(),
        purpose,
        mode,
        provider: provider === null ? null : infoOf(provider),
        payload: text,
        payloadBytes: Buffer.byteLength(text, "utf8"),
        guards: [...guards, recordGuard(id)],
        templateHash: templates()[purpose].hash,
        inferenceId: ctx.inferenceId,
        operatorText: ctx.operatorText,
        status: failed ? "blocked" : mode === "off" ? "off" : missingProvider ? "error" : "sent",
        response: !failed && missingProvider ? noProviderMessage(mode) : null,
        validator: null,
        durationMs: null,
      };
      try {
        opts.store.write(record);
      } catch (e) {
        return { ok: false, recordId: null, reason: `record write failed: ${message(e)}` };
      }
      if (failed) return { ok: false, recordId: id, reason: `${failed.name} guard failed: ${failed.detail}` };
      const schema = responseSchema[purpose];
      if (mode === "off") {
        const value = fallback(purpose, payload);
        if (value === null) return { ok: false, recordId: id, reason: fallbackMissingReason[purpose] };
        const parsed = schema.safeParse(value);
        if (!parsed.success)
          return { ok: false, recordId: id, reason: `fallback failed the ${purpose} response schema: ${issueSummary(parsed.error)}` };
        return { ok: true, value: parsed.data as T, recordId: id, source: "fallback" };
      }
      if (provider === null) return { ok: false, recordId: id, reason: noProviderMessage(mode) };
      const started = Date.now();
      let response: string;
      try {
        response = await provider.call(text, templates[purpose], schema);
      } catch (e) {
        opts.store.update(id, { status: "error", response: message(e), durationMs: Date.now() - started });
        return { ok: false, recordId: id, reason: `${provider.name} call failed: ${message(e)}` };
      }
      const durationMs = Date.now() - started;
      const parsed = parseJson(response, schema);
      if (!parsed.ok) {
        opts.store.update(id, { status: "error", response, durationMs });
        return { ok: false, recordId: id, reason: `response failed the ${purpose} response schema: ${parsed.reason}` };
      }
      opts.store.update(id, { status: "sent", response, durationMs });
      return { ok: true, value: parsed.value as T, recordId: id, source: "model" };
    },
  };
}

function parseJson(text: string, schema: ZodType): { ok: true; value: unknown } | { ok: false; reason: string } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return { ok: false, reason: `not JSON: ${message(e)}` };
  }
  const parsed = schema.safeParse(json);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, reason: issueSummary(parsed.error) };
}
