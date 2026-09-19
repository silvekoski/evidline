import { createWriteStream, mkdirSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join, relative, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Hono } from "hono";
import type { FileEntry } from "@tpm/schemas";
import type { AppContext } from "../context";
import { badRequest } from "../request";

function fileEntry(dataDir: string, file: string): FileEntry {
  const stats = statSync(file);
  return { path: relative(dataDir, file).split(sep).join("/"), name: basename(file), bytes: stats.size, modifiedAt: stats.mtime.toISOString() };
}

export function listCsvFiles(dataDir: string): FileEntry[] {
  mkdirSync(dataDir, { recursive: true });
  return readdirSync(dataDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === ".csv")
    .map((entry) => fileEntry(dataDir, join(entry.parentPath, entry.name)))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export function sanitizeFileName(header: string | undefined): string {
  const raw = header?.trim() ?? "";
  if (raw === "" || raw === "." || raw === ".." || /[\\/\0]/.test(raw)) throw badRequest("x-file-name must be a plain file name");
  const name = raw.replace(/[^A-Za-z0-9._-]/g, "_");
  if (/^\.+$/.test(name)) throw badRequest("x-file-name must be a plain file name");
  return name;
}

export function filesRoutes(ctx: AppContext) {
  return new Hono()
    .get("/", (c) => c.json(listCsvFiles(ctx.dataDir)))
    .post("/", async (c) => {
      const name = sanitizeFileName(c.req.header("x-file-name"));
      const body = c.req.raw.body;
      if (!body) throw badRequest("the request has no body");
      const dir = join(ctx.dataDir, "uploads");
      mkdirSync(dir, { recursive: true });
      const target = join(dir, name);
      await pipeline(Readable.fromWeb(body), createWriteStream(target));
      return c.json(fileEntry(ctx.dataDir, target), 201);
    });
}
