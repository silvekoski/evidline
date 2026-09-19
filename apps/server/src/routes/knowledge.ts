import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { parseCsv } from "@tpm/corpus";
import { CorpusSearchBody, CreateConnectorBody, CreateUploadLinkBody, PatchClaimBody, PatchClaimLinkBody, SourceKind, SourceStatus, type ColumnKnowledge, type Source } from "@tpm/schemas";
import { z } from "zod";
import type { AppContext } from "../context";
import { scheduleSync, transcriptGaps } from "../connector-service";
import { confirmLink, corpusStats, dataSpec, ingestFile, linkOne, openQuestions, search } from "../corpus-service";
import { badRequest, notFound, parseBody } from "../request";

export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

const numericId = (raw: string): number => {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw badRequest("the id must be a positive integer");
  return id;
};

export async function uploadFiles(ctx: AppContext, body: Record<string, string | File | (string | File)[]>): Promise<(Source & { created: boolean })[]> {
  const files = Object.values(body).flat().filter((v): v is File => v instanceof File);
  if (files.length === 0) throw badRequest("the request has no file");
  const out: (Source & { created: boolean })[] = [];
  for (const file of files) {
    if (file.size > MAX_UPLOAD_BYTES) throw new HTTPException(413, { message: `${file.name} is larger than 200 MB` });
    const { source, created } = ingestFile(ctx, { name: file.name, mediaType: file.type, content: Buffer.from(await file.arrayBuffer()) });
    out.push({ ...source, created });
  }
  return out;
}

const AliasImportBody = z.object({ csv: z.string().min(1), tagColumn: z.string().default("tag"), phraseColumns: z.array(z.string()).default(["description", "name", "alias"]) });
const ManualLinkBody = z.object({ columnId: z.number().int() });

export function knowledgeRoutes(ctx: AppContext) {
  const { corpus, registry } = ctx;
  const columnKnowledge = (raw: string): ColumnKnowledge => {
    const column = /^\d+$/.test(raw) ? corpus.columns.get(Number(raw)) : corpus.columns.byName(raw);
    if (!column) throw notFound(`column ${raw}`);
    return { column, claims: corpus.claims.ofColumn(column.id), aliases: corpus.aliases.ofColumn(column.id) };
  };

  return new Hono()
    .get("/knowledge/stats", (c) => c.json(corpusStats(ctx)))
    .get("/sources", (c) => {
      const kind = SourceKind.safeParse(c.req.query("kind")).data;
      const status = SourceStatus.safeParse(c.req.query("status")).data;
      const from = c.req.query("from") || undefined;
      const to = c.req.query("to") || undefined;
      return c.json(corpus.sources.list({ ...(kind ? { kind } : {}), ...(status ? { status } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) }));
    })
    .post("/sources/upload", async (c) => {
      if (Number(c.req.header("content-length")) > MAX_UPLOAD_BYTES) throw new HTTPException(413, { message: "the upload is larger than 200 MB" });
      return c.json(await uploadFiles(ctx, await c.req.parseBody({ all: true })), 201);
    })
    .get("/sources/:id", (c) => {
      const id = numericId(c.req.param("id"));
      const source = corpus.sources.get(id);
      if (!source) throw notFound(`source ${id}`);
      return c.json({ source, segments: corpus.segments.list(id).map(({ block: _block, ...s }) => s) });
    })
    .get("/sources/:id/claims", (c) => c.json(corpus.claims.ofSource(numericId(c.req.param("id")))))
    .get("/sources/:id/blob", (c) => {
      const source = corpus.sources.get(numericId(c.req.param("id")));
      if (!source?.blobPath) throw notFound("blob");
      const body = readFileSync(join(ctx.dir, source.blobPath));
      return c.body(body, 200, { "content-type": source.mediaType, "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(source.title)}` });
    })
    .post("/sources/:id/reprocess", (c) => {
      const source = corpus.sources.get(numericId(c.req.param("id")));
      if (!source) throw notFound("source");
      ctx.jobs.enqueue(source.blobPath ? "normalize" : "chunk", { sourceId: source.id, previous: true });
      return c.json(source, 202);
    })
    .delete("/sources/:id", (c) => {
      const source = corpus.sources.get(numericId(c.req.param("id")));
      if (!source) throw notFound("source");
      corpus.sources.delete(source.id);
      if (source.blobPath && corpus.sources.byHash(source.contentHash) === null) rmSync(join(ctx.dir, source.blobPath), { force: true });
      return c.body(null, 204);
    })
    .post("/upload-links", async (c) => {
      const { hours } = await parseBody(c, CreateUploadLinkBody);
      const { token, expiresAt } = registry.uploadLinks.create(ctx.slug, hours);
      return c.json({ token, workspace: ctx.slug, expiresAt, url: `/upload/${token}` }, 201);
    })
    .post("/search", async (c) => {
      const { query, limit } = await parseBody(c, CorpusSearchBody);
      return c.json(await search(ctx, query, limit));
    })
    .get("/columns", (c) => c.json(corpus.columns.list()))
    .get("/columns/:id/knowledge", (c) => c.json(columnKnowledge(c.req.param("id"))))
    .get("/claims", (c) => c.json(corpus.claims.list()))
    .patch("/claims/:id", async (c) => {
      const id = numericId(c.req.param("id"));
      const { status } = await parseBody(c, PatchClaimBody);
      if (!corpus.claims.get(id)) throw notFound(`claim ${id}`);
      corpus.claims.setStatus(id, status);
      return c.json(corpus.claims.get(id));
    })
    .post("/claims/:id/links", async (c) => {
      const id = numericId(c.req.param("id"));
      const { columnId } = await parseBody(c, ManualLinkBody);
      if (!corpus.claims.get(id)) throw notFound(`claim ${id}`);
      if (!corpus.columns.get(columnId)) throw notFound(`column ${columnId}`);
      corpus.raw.prepare("INSERT INTO claim_column (claim_id, column_id, score, confirmed) VALUES (?, ?, 1, 1) ON CONFLICT(claim_id, column_id) DO UPDATE SET confirmed = 1").run(id, columnId);
      return c.json(corpus.claims.get(id), 201);
    })
    .post("/claims/:id/relink", (c) => {
      const id = numericId(c.req.param("id"));
      if (!corpus.claims.get(id)) throw notFound(`claim ${id}`);
      linkOne(ctx, id);
      return c.json(corpus.claims.get(id));
    })
    .patch("/claim-links/:id", async (c) => {
      const id = numericId(c.req.param("id"));
      const { confirmed } = await parseBody(c, PatchClaimLinkBody);
      const link = corpus.links.get(id);
      if (!link) throw notFound(`link ${id}`);
      confirmLink(ctx, id, confirmed);
      return c.json(corpus.claims.get(link.claimId));
    })
    .get("/open-questions", (c) => c.json(openQuestions(ctx)))
    .post("/spec", (c) => c.json(dataSpec(ctx)))
    .post("/aliases/import", async (c) => {
      const { csv, tagColumn, phraseColumns } = await parseBody(c, AliasImportBody);
      const { rows } = parseCsv(csv);
      const header = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
      const tagAt = header.indexOf(tagColumn.toLowerCase());
      if (tagAt < 0) throw badRequest(`the CSV has no column ${tagColumn}`);
      const phraseAt = phraseColumns.map((p) => header.indexOf(p.toLowerCase())).filter((i) => i >= 0);
      let added = 0;
      let unknown = 0;
      corpus.transaction(() => {
        for (const row of rows.slice(1)) {
          const column = corpus.columns.byName(row[tagAt]?.trim() ?? "");
          if (!column) {
            unknown++;
            continue;
          }
          for (const i of phraseAt) {
            const phrase = row[i]?.trim();
            if (phrase) {
              corpus.aliases.add(column.id, phrase);
              added++;
            }
          }
        }
      });
      return c.json({ added, unknown });
    })
    .get("/egress-log", (c) => c.json(corpus.egressLog.list()))
    .get("/jobs", (c) => c.json(registry.jobs.list(ctx.slug)))
    .post("/jobs/retry", (c) => c.json({ retried: registry.jobs.retryFailed(ctx.slug) }))
    .post("/jobs/run", async (c) => c.json({ ran: await ctx.jobs.runPending() }))
    .get("/connectors", (c) => c.json(registry.connectors.list(ctx.slug)))
    .post("/connectors", async (c) => {
      const body = await parseBody(c, CreateConnectorBody);
      const connector = registry.connectors.create({ ...body, workspace: body.kind === "upload" ? ctx.slug : body.workspace });
      scheduleSync(registry, connector);
      if (connector.kind === "teams") registry.jobs.enqueue(null, "renew-subscriptions", {}, { dedupe: "renew-subscriptions" });
      return c.json(connector, 201);
    })
    .get("/connectors/:id/gaps", async (c) => {
      const connector = registry.connectors.get(numericId(c.req.param("id")));
      if (!connector) throw notFound("connector");
      if (connector.kind !== "teams") throw badRequest("only a Teams connector has a transcript gap list");
      return c.json(await transcriptGaps(ctx, connector, Number(c.req.query("days")) || 30));
    })
    .post("/connectors/:id/sync", (c) => {
      const id = numericId(c.req.param("id"));
      const connector = registry.connectors.get(id);
      if (!connector) throw notFound(`connector ${id}`);
      ctx.jobs.enqueue("connector-sync", { connectorId: id }, { dedupe: `connector-sync-${id}` });
      return c.json(connector, 202);
    })
    .delete("/connectors/:id", (c) => {
      registry.connectors.delete(numericId(c.req.param("id")));
      return c.body(null, 204);
    });
}
