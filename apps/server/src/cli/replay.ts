import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { audioExtensions, supportedExtensions } from "@tpm/corpus";
import { openRegistryAt } from "../context";
import { dataSpec, ingestFile, mediaTypeOf, openQuestions } from "../corpus-service";
import { dataDir, repoRoot } from "../paths";
import { createWorkspaceManager } from "../workspaces";

const [slug, folderArg] = process.argv.slice(2);
const folder = folderArg ? resolve(process.env.INIT_CWD ?? process.cwd(), folderArg) : undefined;
if (!slug || !folder) {
  console.log("usage: pnpm replay <workspace-slug> <folder>\nIngests every supported file of the folder into the workspace, runs the jobs, and prints what the corpus says.");
  process.exit(1);
}
const envFile = join(repoRoot, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const registry = openRegistryAt(dataDir, () => {});
const manager = createWorkspaceManager({ dataDir, registry, webDist: null, log: (line) => console.log(`  ${line}`) });
if (!registry.workspaces.get(slug)) manager.create({ slug, name: slug, domains: [] });
const ws = manager.open(slug)!;
const { ctx } = ws;

const known = new Set<string>([...supportedExtensions, ...audioExtensions]);
const files = readdirSync(folder)
  .map((name) => join(folder, name))
  .filter((path) => statSync(path).isFile() && known.has(extname(path).toLowerCase()));

console.log(`replay into ${slug}: ${files.length} files from ${folder}`);
let created = 0;
for (const path of files) {
  const { source, created: fresh } = ingestFile(ctx, { name: basename(path), mediaType: mediaTypeOf(path), content: readFileSync(path), occurredAt: statSync(path).mtime.toISOString() });
  if (fresh) created++;
  console.log(`  ${fresh ? "new " : "seen"} ${source.id} ${source.title}`);
}

const started = Date.now();
const deadline = started + 30 * 60_000;
let ran = 0;
while (Date.now() < deadline) {
  ran += await ctx.jobs.runPending();
  if (registry.jobs.counts(slug).queued === 0) break;
  await new Promise((r) => setTimeout(r, 500));
}
const jobs = registry.jobs.counts(slug);
const sources = ctx.corpus.sources.list();
const claims = ctx.corpus.claims.list();
const questions = openQuestions(ctx);
const spec = dataSpec(ctx);
const linked = claims.filter((c) => c.links.length > 0).length;

console.log(`\n${created} new sources, ${ran} jobs ran here, ${Math.round((Date.now() - started) / 1000)} s, ${jobs.failed} failed jobs`);
console.log(`sources by status: ${JSON.stringify(Object.fromEntries(sources.map((s) => s.status).reduce((m, s) => m.set(s, (m.get(s) ?? 0) + 1), new Map<string, number>())))}`);
console.log(`claims: ${claims.length} accepted, ${ctx.corpus.counters.get("claims_rejected")} rejected by the quote check, ${linked} linked to a column`);
console.log(`columns: ${ctx.corpus.columns.count()}, open questions: ${questions.length}, spec sentences: ${spec.sentences.length}`);
for (const s of sources.filter((s) => s.status === "failed" || s.status === "needs_ocr")) console.log(`  ${s.status} ${s.title}: ${s.error}`);
console.log("\nsample claims:");
for (const c of claims.slice(0, 10)) console.log(`  [${c.provenance}] ${c.statement} <- "${c.quote.slice(0, 60)}" (${c.sourceTitle}${c.links[0] ? `, ${c.links[0].column} ${c.links[0].score}` : ""})`);
manager.close();
registry.close();
