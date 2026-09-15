import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { serializeTaskFile } from "./frontmatter.js";
import { resolveRef } from "./lookup.js";
import {
  createTaskFile,
  ensureDirs,
  existingIds,
  folderPath,
  listTaskFiles,
  saveTaskFile,
  tasksRoot,
  type Folder,
} from "./storage.js";
import { cleanup, makeTasksDir } from "../test/helpers.js";
import type { Status, Task } from "./task.js";

let dir: string;

beforeEach(async () => {
  dir = await makeTasksDir();
  process.env["TASKS_DIR"] = dir;
});

afterEach(async () => {
  delete process.env["TASKS_DIR"];
  await cleanup(dir);
});

const task = (over: Partial<Task> = {}): Task => ({
  id: over.id ?? "a3f9k2",
  title: over.title ?? "A title",
  status: over.status ?? "inbox",
  project: over.project ?? "proj",
  created: over.created ?? "2026-09-15T14:02:00Z",
});

const BODY = "## Description\nd\n\n## Plan\n\n## Log\n";

/** Write a file straight to disk, bypassing the normal code path. */
async function seed(folder: Folder, stem: string, t: Task, body = BODY): Promise<void> {
  await ensureDirs();
  await writeFile(path.join(folderPath(folder), `${stem}.md`), serializeTaskFile(t, body), "utf8");
}

describe("tasksRoot", () => {
  it("honours TASKS_DIR", () => {
    expect(tasksRoot()).toBe(path.resolve(dir));
  });

  it("falls back to ~/tasks when TASKS_DIR is unset", () => {
    delete process.env["TASKS_DIR"];
    // setup.ts points HOME at a sandbox, so this never names the real home dir.
    expect(tasksRoot().endsWith(path.join("tasks"))).toBe(true);
  });
});

describe("ensureDirs", () => {
  it("creates active/ and archive/ on demand", async () => {
    await ensureDirs();
    expect((await readdir(dir)).sort()).toEqual(["active", "archive"]);
  });
});

describe("listTaskFiles", () => {
  it("returns an empty list for a fresh root", async () => {
    expect(await listTaskFiles("active")).toEqual([]);
  });

  it("sorts oldest first by created", async () => {
    await seed("active", "b-bbbbbb", task({ id: "bbbbbb", created: "2026-09-15T10:00:00Z" }));
    await seed("active", "a-aaaaaa", task({ id: "aaaaaa", created: "2026-09-14T10:00:00Z" }));
    expect((await listTaskFiles("active")).map((f) => f.task.id)).toEqual(["aaaaaa", "bbbbbb"]);
  });

  it("breaks created ties deterministically by stem", async () => {
    const created = "2026-09-15T10:00:00Z";
    await seed("active", "zzz-zzzzzz", task({ id: "zzzzzz", created }));
    await seed("active", "aaa-aaaaaa", task({ id: "aaaaaa", created }));
    expect((await listTaskFiles("active")).map((f) => f.stem)).toEqual(["aaa-aaaaaa", "zzz-zzzzzz"]);
  });

  it("ignores non-markdown files", async () => {
    await ensureDirs();
    await writeFile(path.join(folderPath("active"), "notes.txt"), "hi", "utf8");
    expect(await listTaskFiles("active")).toEqual([]);
  });

  it("fails loudly on the first invalid file", async () => {
    await ensureDirs();
    await writeFile(path.join(folderPath("active"), "broken-aaaaaa.md"), "not a task", "utf8");
    await expect(listTaskFiles("active")).rejects.toThrow("broken-aaaaaa.md");
  });
});

describe("saveTaskFile", () => {
  it("writes the status before moving the file", async () => {
    const file = await createTaskFile(task({ status: "in-progress" }), BODY, "a-a3f9k2");
    const saved = await saveTaskFile({ ...file, task: { ...file.task, status: "done" as Status } });

    expect(saved.folder).toBe("archive");
    expect(await readdir(folderPath("active"))).toEqual([]);
    expect(await readFile(saved.path, "utf8")).toContain("status: done");
  });

  it("moves a restored task back into active/", async () => {
    await seed("archive", "a-a3f9k2", task({ status: "done" }));
    const file = await resolveRef("a3f9k2");
    const saved = await saveTaskFile({ ...file, task: { ...file.task, status: "todo" } });

    expect(saved.folder).toBe("active");
    expect(await readdir(folderPath("archive"))).toEqual([]);
  });

  it("repairs an interrupted archive: a done task still sitting in active/", async () => {
    await seed("active", "a-a3f9k2", task({ status: "done" }));
    // ls hides it...
    expect(await listTaskFiles("active")).toHaveLength(1); // storage still reads it
    const file = await resolveRef("a3f9k2");
    // ...and the next archiving command relocates it.
    const saved = await saveTaskFile({ ...file, task: { ...file.task, status: "todo" } });
    expect(saved.folder).toBe("active");

    await seed("active", "b-bbbbbb", task({ id: "bbbbbb", status: "rejected" }));
    const stray = await resolveRef("bbbbbb");
    const moved = await saveTaskFile(stray);
    expect(moved.folder).toBe("archive");
  });
});

describe("existingIds", () => {
  it("collects ids from both folders", async () => {
    await seed("active", "a-aaaaaa", task({ id: "aaaaaa" }));
    await seed("archive", "b-bbbbbb", task({ id: "bbbbbb", status: "done" }));
    expect(await existingIds()).toEqual(new Set(["aaaaaa", "bbbbbb"]));
  });
});
