import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
export const dataDir = join(repoRoot, "data");
export const dbPath = join(dataDir, "tpm.db");
export const webDist = join(repoRoot, "apps", "web", "dist");
