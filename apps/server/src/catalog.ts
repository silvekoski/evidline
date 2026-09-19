import type { ColumnCandidate } from "@tpm/corpus";
import type { AppContext } from "./context";
import type { CorpusDb } from "./corpus-db";
import { sensorReport } from "./reports";

export const EMBED_BATCH = 32;

export function enqueueEmbeds(ctx: AppContext, chunkIds: number[]): void {
  for (let i = 0; i < chunkIds.length; i += EMBED_BATCH) ctx.jobs.enqueue("embed", { chunkIds: chunkIds.slice(i, i + EMBED_BATCH) });
}

export function columnCandidates(corpus: CorpusDb): (ColumnCandidate & { id: number; hypothesis: string | null })[] {
  return corpus.columns.list().map((c) => ({ id: c.id, name: c.name, alias: c.alias, hypothesis: c.hypothesis, phrases: corpus.aliases.ofColumn(c.id) }));
}


export function refreshCatalog(ctx: AppContext, runId: string): void {
  const run = ctx.db.runs.get(runId);
  if (!run || run.status === "failed") return;
  let report: ReturnType<typeof sensorReport>;
  try {
    report = sensorReport(ctx.db, run);
  } catch (e) {
    ctx.log(`catalog refresh for run ${runId} skipped: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  const roles = new Map(ctx.db.inferences.list(runId, "role").filter((i) => i.status !== "revised").map((i) => [i.sensor, i]));
  const changed: number[] = [];
  ctx.corpus.transaction(() => {
    for (const s of report.sensors) {
      const role = roles.get(s.alias);
      const hypothesisConfidence = role?.stage === "role" ? role.value.hypothesisConfidence : null;
      const description = [`${s.sourceName} (${s.alias})`, s.hypothesisName ? `is ${s.hypothesisName}` : `has the role ${s.role}`, `and a ${s.signalType} signal`].join(" ");
      const before = ctx.corpus.columns.byName(s.sourceName);
      const column = ctx.corpus.columns.upsert({
        name: s.sourceName,
        alias: s.alias,
        runId,
        role: s.role,
        signalType: s.signalType,
        hypothesis: s.hypothesisName,
        confidence: Math.min(hypothesisConfidence ?? 1, s.roleConfidence),
        description,
      });
      if (before?.description === description && ctx.corpus.columns.descriptionChunkId(column.id) !== null) continue;
      ctx.corpus.chunks.deleteOfColumn(column.id);
      changed.push(ctx.corpus.chunks.insert({ sourceId: null, kind: "column", text: description, locator: { kind: "column", column: s.sourceName }, tokens: Math.ceil(description.length / 4), segmentFrom: null, segmentTo: null, columnId: column.id }));
    }
  });
  enqueueEmbeds(ctx, changed);
}
