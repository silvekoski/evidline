import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import { openRegistryAt } from "../context";
import { search } from "../corpus-service";
import { dataDir, repoRoot } from "../paths";
import { createWorkspaceManager } from "../workspaces";

const GoldenSet = z.object({
  workspace: z.string(),
  questions: z.array(z.object({ question: z.string(), sourceTitle: z.string().optional(), contains: z.string().optional() }).refine((q) => q.sourceTitle || q.contains, "each question needs sourceTitle or contains")),
});

const [fileArg] = process.argv.slice(2);
const file = fileArg ? resolve(process.env.INIT_CWD ?? process.cwd(), fileArg) : undefined;
if (!file) {
  console.log('usage: pnpm golden <file.json>\nThe file holds { workspace, questions: [{ question, sourceTitle?, contains? }] }. A hit counts when a result in the top 3 comes from sourceTitle or its snippet holds the text.');
  process.exit(1);
}
const envFile = join(repoRoot, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);
const golden = GoldenSet.parse(JSON.parse(readFileSync(file, "utf8")));
const registry = openRegistryAt(dataDir, () => {});
const manager = createWorkspaceManager({ dataDir, registry, webDist: null, log: () => {} });
const ws = manager.open(golden.workspace);
if (!ws) throw new Error(`workspace ${golden.workspace} does not exist`);

let hits = 0;
for (const q of golden.questions) {
  const results = await search(ws.ctx, q.question, 3);
  const at = results.findIndex((r) => (q.sourceTitle && r.sourceTitle === q.sourceTitle) || (q.contains && r.snippet.toLowerCase().includes(q.contains.toLowerCase())));
  if (at >= 0) hits++;
  console.log(`${at >= 0 ? `hit@${at + 1}` : "miss "} ${q.question}${at < 0 && results[0] ? ` (top: ${results[0].sourceTitle}, ${results[0].snippet.slice(0, 60).replace(/\n/g, " ")})` : ""}`);
}
console.log(`\n${hits} of ${golden.questions.length} in the top 3 (${Math.round((100 * hits) / golden.questions.length)} %). Target: 80 %.`);
console.log(`embedder: ${ws.ctx.corpus.embeddingMeta.get()?.model ?? "none"}`);
manager.close();
registry.close();
process.exit(hits / golden.questions.length >= 0.8 ? 0 : 1);
