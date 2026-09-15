import { writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UserError } from "./errors.js";
import { serializeTaskFile } from "./frontmatter.js";
import { normalizeRef, resolveRef } from "./lookup.js";
import { ensureDirs, folderPath, type Folder } from "./storage.js";
import { cleanup, makeTasksDir } from "../test/helpers.js";
import type { Task } from "./task.js";

let dir: string;

beforeEach(async () => {
  dir = await makeTasksDir();
  process.env["TASKS_DIR"] = dir;
  await ensureDirs();
});

afterEach(async () => {
  delete process.env["TASKS_DIR"];
  await cleanup(dir);
});

const BODY = "## Description\nd\n\n## Plan\n\n## Log\n";

async function seed(folder: Folder, stem: string, id: string, status: Task["status"] = "inbox") {
  const task: Task = { id, title: "T", status, project: "p", created: "2026-09-15T14:02:00Z" };
  await writeFile(path.join(folderPath(folder), `${stem}.md`), serializeTaskFile(task, BODY), "utf8");
}

describe("normalizeRef", () => {
  it("accepts what tab completion produces", () => {
    expect(normalizeRef("fix-thing-a3f9k2.md")).toBe("fix-thing-a3f9k2");
    expect(normalizeRef("active/fix-thing-a3f9k2.md")).toBe("fix-thing-a3f9k2");
    expect(normalizeRef("  A3F9K2 ")).toBe("a3f9k2");
  });
});

describe("resolveRef", () => {
  it("matches a full filename stem", async () => {
    await seed("active", "fix-thing-a3f9k2", "a3f9k2");
    expect((await resolveRef("fix-thing-a3f9k2")).task.id).toBe("a3f9k2");
  });

  it("matches an exact id", async () => {
    await seed("active", "fix-thing-a3f9k2", "a3f9k2");
    expect((await resolveRef("a3f9k2")).stem).toBe("fix-thing-a3f9k2");
  });

  it("matches a unique id prefix of at least three characters", async () => {
    await seed("active", "fix-thing-a3f9k2", "a3f9k2");
    expect((await resolveRef("a3f")).task.id).toBe("a3f9k2");
  });

  it("does not treat a two-character ref as a prefix match", async () => {
    await seed("active", "fix-thing-a3f9k2", "a3f9k2");
    await expect(resolveRef("a3")).rejects.toThrow('no task matches "a3"');
  });

  it("prefers an exact id over another task's prefix match", async () => {
    await seed("active", "one-abc123", "abc123");
    await seed("active", "two-abc123x", "abc12x");
    // "abc123" is an exact id for the first and would prefix-match nothing else.
    expect((await resolveRef("abc123")).stem).toBe("one-abc123");
  });

  it("searches the archive too", async () => {
    await seed("archive", "old-zzzzzz", "zzzzzz", "done");
    expect((await resolveRef("zzzzzz")).folder).toBe("archive");
  });

  it("reports an ambiguous prefix with one stem per line", async () => {
    await seed("active", "one-abc111", "abc111");
    await seed("active", "two-abc222", "abc222");
    await expect(resolveRef("abc")).rejects.toThrow(UserError);
    await expect(resolveRef("abc")).rejects.toThrow(
      '"abc" matches multiple tasks:\none-abc111\ntwo-abc222',
    );
  });

  it("reports no match for an unknown ref", async () => {
    await expect(resolveRef("nosuch")).rejects.toThrow('no task matches "nosuch"');
  });
});
