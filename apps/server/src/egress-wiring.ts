import { parse } from "node:path";
import { buildLeakIndex, createGateway, getProvider, type EgressStore, type Gateway, type LeakIndex } from "@tpm/egress";
import type { Db } from "./db";
import { newEgressId } from "./ids";
import { getModelSettings } from "./settings";

const cacheSize = 4;
const emptyIndex = buildLeakIndex([], []);
const splitValue = /\[(?:[^\]=]*=)?([^\]]+)\]/g;

export function forbiddenNames(db: Db, runId: string): string[] {
  const run = db.runs.get(runId);
  const sourceNames = db.sensors.list(runId).map((s) => s.sourceName);
  const fields = sourceNames.filter((name) => name.includes(".")).map((name) => name.slice(0, name.indexOf(".")));
  const categoryValues = sourceNames.flatMap((name) => [...name.matchAll(splitValue)].map((m) => m[1] as string));
  const runNames = run ? [...run.quarantined, run.name, parse(run.name).name] : [];
  return [...sourceNames, ...fields, ...categoryValues, ...runNames];
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

export function wireGateway(db: Db): Gateway {
  return createGateway({
    store: createSqliteStore(db),
    getSettings: () => getModelSettings(db),
    getProvider,
    leakIndex: createLeakIndexCache(db),
    nowIso: () => new Date().toISOString(),
    newId: newEgressId,
  });
}
