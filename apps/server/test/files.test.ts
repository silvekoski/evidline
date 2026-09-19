import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileList } from "@tpm/schemas";
import { fixture, type Fixture } from "./fixture";

describe("files routes", () => {
  let f: Fixture;
  beforeEach(() => {
    f = fixture();
    mkdirSync(join(f.ctx.dataDir, "nested"), { recursive: true });
    writeFileSync(join(f.ctx.dataDir, "demo-stream.csv"), "time,a\n1,2\n");
    writeFileSync(join(f.ctx.dataDir, "nested", "records.CSV"), "a\n1\n2\n");
    writeFileSync(join(f.ctx.dataDir, "notes.txt"), "not a csv");
  });
  afterEach(() => f.close());

  it("lists csv files recursively with sizes", async () => {
    const res = await f.app.request("/api/files");
    expect(res.status).toBe(200);
    const files = FileList.parse(await res.json());
    expect(files.map((e) => e.path)).toEqual(["demo-stream.csv", "nested/records.CSV"]);
    expect(files[0]).toMatchObject({ name: "demo-stream.csv", bytes: 11 });
    expect(files[1]?.modifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("lists a symlink to a csv file with the target size", async () => {
    writeFileSync(join(f.dir, "outside.csv"), "a,b\n1,2\n3,4\n");
    symlinkSync(join("..", "outside.csv"), join(f.ctx.dataDir, "linked.csv"));
    const files = FileList.parse(await (await f.app.request("/api/files")).json());
    expect(files.find((e) => e.path === "linked.csv")).toMatchObject({ name: "linked.csv", bytes: 12 });
  });

  it("skips a dangling symlink and lists the other files", async () => {
    symlinkSync(join("..", "missing.csv"), join(f.ctx.dataDir, "dangling.csv"));
    const res = await f.app.request("/api/files");
    expect(res.status).toBe(200);
    const files = FileList.parse(await res.json());
    expect(files.map((e) => e.path)).toEqual(["demo-stream.csv", "nested/records.CSV"]);
  });

  it("answers 413 and writes no file when the content length exceeds the free space", async () => {
    const res = await f.app.request("/api/files", { method: "POST", headers: { "x-file-name": "huge.csv", "content-length": "999999999999999999" }, body: "x" });
    expect(res.status).toBe(413);
    const { error } = (await res.json()) as { error: string };
    expect(error).toMatch(/^The file is 1000000000\.0 GB and data\/ has \d+\.\d GB free\. Link the file under data\/ instead: ln -s \.\.\/huge\.csv data\/huge\.csv$/);
    expect(existsSync(join(f.ctx.dataDir, "uploads", "huge.csv"))).toBe(false);
  });

  it("streams an upload to data/uploads and returns its entry", async () => {
    const body = "time,a,b\n1,2,3\n2,3,4\n";
    const res = await f.app.request("/api/files", { method: "POST", headers: { "x-file-name": "my file (1).csv" }, body });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ path: "uploads/my_file__1_.csv", name: "my_file__1_.csv", bytes: body.length });
    expect(readFileSync(join(f.ctx.dataDir, "uploads", "my_file__1_.csv"), "utf8")).toBe(body);
    const list = FileList.parse(await (await f.app.request("/api/files")).json());
    expect(list.map((e) => e.path)).toContain("uploads/my_file__1_.csv");
  });

  it("rejects path traversal and a missing name", async () => {
    for (const name of ["../evil.csv", "a/b.csv", "..", "c:\\x.csv"]) {
      const res = await f.app.request("/api/files", { method: "POST", headers: { "x-file-name": name }, body: "x" });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "x-file-name must be a plain file name" });
    }
    const missing = await f.app.request("/api/files", { method: "POST", body: "x" });
    expect(missing.status).toBe(400);
  });

  it("answers unknown api paths with a json 404", async () => {
    const res = await f.app.request("/api/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "GET /api/nope not found" });
  });
});
