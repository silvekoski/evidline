import { parse } from "node:path";
import { buildLeakIndex, createGateway, type EgressStore, type Gateway, type GatewayOptions, type LeakIndex } from "@tpm/egress";
import { EgressPayload, InvestigationTool, Stage } from "@tpm/schemas";
import type { Db } from "./db";
import { newEgressId } from "./ids";
import { getModelMode } from "./settings";

const cacheSize = 4;
const emptyIndex = buildLeakIndex([], []);
const splitValue = /\[(?:[^\]=]*=)?([^\]]+)\]/g;

type SchemaDef = { shape?: Record<string, unknown>; entries?: Record<string, unknown>; values?: unknown[]; options?: unknown[]; element?: unknown; innerType?: unknown; keyType?: unknown; valueType?: unknown };

export const payloadVocabulary = ((): Set<string> => {
  const words = new Set<string>([...InvestigationTool.options, ...Stage.options]);
  const visit = (schema: unknown): void => {
    const def = (schema as { _zod?: { def?: SchemaDef } } | null)?._zod?.def;
    if (!def) return;
    for (const [key, value] of Object.entries(def.shape ?? {})) {
      words.add(key);
      visit(value);
    }
    for (const value of [...Object.values(def.entries ?? {}), ...(def.values ?? [])]) if (typeof value === "string") words.add(value);
    for (const inner of [...(def.options ?? []), def.element, def.innerType, def.keyType, def.valueType]) visit(inner);
  };
  visit(EgressPayload);
  return new Set([...words].map((w) => w.toLowerCase()));
})();

export function forbiddenNames(db: Db, runId: string): string[] {
  const run = db.runs.get(runId);
  const sourceNames = db.sensors.list(runId).map((s) => s.sourceName);
  const fields = sourceNames.filter((name) => name.includes(".")).map((name) => name.slice(0, name.indexOf(".")));
  const categoryValues = sourceNames.flatMap((name) => [...name.matchAll(splitValue)].map((m) => m[1] as string));
  const runNames = run ? [...run.quarantined, run.name, parse(run.name).name] : [];
  return [...sourceNames, ...fields, ...categoryValues, ...runNames].filter((name) => !/^\d+$/.test(name) && !payloadVocabulary.has(name.toLowerCase()));
}

export function createLeakIndexCache(db: Db): (runId: string | null) => LeakIndex {
  const cache = new Map<string, LeakIndex>();
  return (runId) => {
    if (runId === null) return emptyIndex;
    const cached = cache.get(runId);
    if (cached) return cached;
    const series = db.grids.series(runId);
    const index = buildLeakIndex(series, forbiddenNames(db, runId));
    if (series.length === 0) return index;
    cache.set(runId, index);
    if (cache.size > cacheSize) cache.delete(cache.keys().next().value as string);
    return index;
  };
}

export function createSqliteStore(db: Db): EgressStore {
  return {
    write: (record) => db.egress.save(record),
    update(id, patch) {
      const record = db.egress.get(id);
      if (!record) throw new Error(`no egress record ${id}`);
      db.egress.save({ ...record, ...patch });
    },
  };
}

export function wireGateway(db: Db, resolvers: Pick<GatewayOptions, "resolveProvider" | "resolveReviewers"> = {}): Gateway {
  const gateway: Gateway = createGateway({
    store: createSqliteStore(db),
    getMode: () => getModelMode(db, gateway),
    leakIndex: createLeakIndexCache(db),
    nowIso: () => new Date().toISOString(),
    newId: newEgressId,
    ...resolvers,
  });
  return gateway;
}
