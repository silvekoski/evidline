import { createWriteStream, mkdirSync, readdirSync, rmSync, statfsSync, statSync, type Stats } from "node:fs";
import { basename, extname, join, relative, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { FileEntry } from "@tpm/schemas";
import type { AppContext } from "../context";
import { badRequest } from "../request";

function regularFile(file: string): Stats | null {
  try {
    const stats = statSync(file);
    return stats.isFile() ? stats : null;
  } catch {
    return null;
  }
}

function fileEntry(dataDir: string, file: string, stats: Stats): FileEntry {
  return { path: relative(dataDir, file).split(sep).join("/"), name: basename(file), bytes: stats.size, modifiedAt: stats.mtime.toISOString() };
}

export function listCsvFiles(dataDir: string): FileEntry[] {
  mkdirSync(dataDir, { recursive: true });
  return readdirSync(dataDir, { recursive: true, withFileTypes: true })
    .filter((entry) => extname(entry.name).toLowerCase() === ".csv")
    .flatMap((entry) => {
      const file = join(entry.parentPath, entry.name);
      const stats = regularFile(file);
      return stats ? [fileEntry(dataDir, file, stats)] : [];
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

export function sanitizeFileName(header: string | undefined): string {
  const raw = header?.trim() ?? "";
  if (raw === "" || raw === "." || raw === ".." || /[\\/\0]/.test(raw)) throw badRequest("x-file-name must be a plain file name");
  const name = raw.replace(/[^A-Za-z0-9._-]/g, "_");
  if (/^\.+$/.test(name)) throw badRequest("x-file-name must be a plain file name");
  return name;
}

const gb = (bytes: number): string => (bytes / 1e9).toFixed(1);

function assertFits(dataDir: string, name: string, contentLength: string | undefined): void {
  const bytes = Number(contentLength);
  if (!contentLength || !Number.isFinite(bytes)) return;
  const fs = statfsSync(dataDir);
  const free = fs.bavail * fs.bsize;
  if (bytes <= free) return;
  const stem = name.replace(/\.csv$/i, "");
  throw new HTTPException(413, { message: `The file is ${gb(bytes)} GB and data/ has ${gb(free)} GB free. Link the file under data/ instead: ln -s ../${stem}.csv data/${stem}.csv` });
}

export function filesRoutes(ctx: AppContext) {
  return new Hono()
    .get("/", (c) => c.json(listCsvFiles(ctx.dataDir)))
    .post("/", async (c) => {
      const name = sanitizeFileName(c.req.header("x-file-name"));
      const body = c.req.raw.body;
      if (!body) throw badRequest("the request has no body");
      mkdirSync(ctx.dataDir, { recursive: true });
      assertFits(ctx.dataDir, name, c.req.header("content-length"));
      const dir = join(ctx.dataDir, "uploads");
      mkdirSync(dir, { recursive: true });
      const target = join(dir, name);
      try {
        await pipeline(Readable.fromWeb(body), createWriteStream(target));
      } catch (e) {
        rmSync(target, { force: true });
        throw e;
      }
      return c.json(fileEntry(ctx.dataDir, target, statSync(target)), 201);
    });
}
