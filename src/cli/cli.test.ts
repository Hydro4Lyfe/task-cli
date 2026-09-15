import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, cli, makeTasksDir, type CliResult } from "../test/helpers.js";

let dir: string;

beforeEach(async () => {
  dir = await makeTasksDir();
});

afterEach(async () => {
  await cleanup(dir);
});

/** Run the CLI from inside the repo, so the project resolves to `task-cli`. */
const run = (...args: string[]): Promise<CliResult> => cli(args, { tasksDir: dir });

/** Run from a directory that is not a git repo. */
const runOutsideRepo = (...args: string[]): Promise<CliResult> =>
  cli(args, { tasksDir: dir, cwd: dir });

async function addTask(description: string, ...extra: string[]): Promise<string> {
  const result = await run("add", description, ...extra);
  expect(result.code).toBe(0);
  return result.stdout.replace("Created ", "").trim();
}

const idOf = (stem: string): string => stem.slice(stem.lastIndexOf("-") + 1);

/** Directory contents, treating "never created" the same as "empty". */
async function listOrEmpty(target: string): Promise<string[]> {
  try {
    return await readdir(target);
  } catch {
    return [];
  }
}

async function setPlan(stem: string, folder = "active"): Promise<void> {
  const file = path.join(dir, folder, `${stem}.md`);
  const raw = await readFile(file, "utf8");
  await writeFile(file, raw.replace("## Plan\n", "## Plan\n\n1. A step\n"), "utf8");
}

describe("task add", () => {
  it("creates a task and reports the stem", async () => {
    const result = await run("add", "Fix token refresh failing after laptop sleep. It expires.");
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toMatch(/^Created fix-token-refresh-failing-after-laptop-[0-9a-z]{6}$/);
  });

  it("writes a valid file with the three required sections", async () => {
    const stem = await addTask("Fix bug: token refresh fails #4 after sleep.");
    const raw = await readFile(path.join(dir, "active", `${stem}.md`), "utf8");
    // The colon in the title must be quoted or the file would not parse.
    expect(raw).toContain("title: 'Fix bug: token refresh fails #4 after sleep.'");
    expect(raw).toContain("status: inbox");
    expect(raw).toContain("project: task-cli");
    expect(raw).toMatch(/created: '\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z'/);
    for (const heading of ["## Description", "## Plan", "## Log"]) {
      expect(raw).toContain(heading);
    }
  });

  it("supports --proposed and --json", async () => {
    const result = await run("add", "Something to do.", "--proposed", "--json");
    expect(result.code).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.status).toBe("proposed");
    expect(Object.keys(parsed)).toEqual(["id", "title", "status", "project", "created", "stem"]);
  });

  it("honours --project", async () => {
    const result = await run("add", "Task text.", "--project", "other-repo", "--json");
    expect(JSON.parse(result.stdout).project).toBe("other-repo");
  });

  it("rejects an empty description", async () => {
    const result = await run("add", "   ");
    expect(result.code).toBe(1);
    expect(result.stderr.trim()).toBe("Error: task description required");
    expect(result.stdout).toBe("");
  });

  it("fails outside a git repo with no --project, creating no file", async () => {
    const result = await runOutsideRepo("add", "Some task.");
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      "Error: not in a git repository. Run inside a repo or pass --project <name>.",
    );
    // Resolution happens before any directory is created, so nothing is written.
    expect(await listOrEmpty(path.join(dir, "active"))).toEqual([]);
  });

  it("still works outside a repo when given --project", async () => {
    const result = await runOutsideRepo("add", "Some task.", "--project", "manual");
    expect(result.code).toBe(0);
  });
});

describe("task ls", () => {
  it("reports no tasks on stderr and exits 0", async () => {
    const result = await run("ls");
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr.trim()).toBe("No tasks.");
  });

  it("prints the spec's columns and a project footer on stderr", async () => {
    await addTask("First task.");
    const result = await run("ls");
    expect(result.code).toBe(0);
    expect(result.stdout.split("\n")[0]).toMatch(/^ID\s+STATUS\s+TITLE\s+PROJECT\s+AGE$/);
    expect(result.stderr.trim()).toBe("1 task in task-cli · 0 in other projects (--all)");
  });

  it("counts tasks hidden by the project filter", async () => {
    await addTask("Mine.");
    await run("add", "Theirs.", "--project", "elsewhere");
    expect((await run("ls")).stderr.trim()).toBe("1 task in task-cli · 1 in other projects (--all)");
  });

  it("shows every project with --all and no footer", async () => {
    await addTask("Mine.");
    await run("add", "Theirs.", "--project", "elsewhere");
    const result = await run("ls", "--all");
    expect(result.stdout.trim().split("\n")).toHaveLength(3);
    expect(result.stderr).toBe("");
  });

  it("behaves as --all outside a git repo, without erroring", async () => {
    await run("add", "One.", "--project", "alpha");
    await run("add", "Two.", "--project", "beta");
    const result = await runOutsideRepo("ls");
    expect(result.code).toBe(0);
    expect(result.stdout.trim().split("\n")).toHaveLength(3);
    expect(result.stderr).toBe("");
  });

  it("filters by status and rejects an unknown one", async () => {
    await addTask("One.");
    expect((await run("ls", "--status", "inbox")).stdout).toContain("inbox");
    expect((await run("ls", "--status", "todo")).stderr.trim()).toBe("No tasks.");

    const bad = await run("ls", "--status", "nope");
    expect(bad.code).toBe(1);
    expect(bad.stderr).toContain('Error: invalid status "nope"');
  });

  it("emits [] for --json with no matches and stays silent on stderr", async () => {
    const result = await run("ls", "--json");
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([]);
    expect(result.stderr).toBe("");
  });

  it("exits 2 with no partial stdout when a file is invalid", async () => {
    await addTask("Fine.");
    await writeFile(path.join(dir, "active", "broken-zzzzzz.md"), "not a task file", "utf8");
    const result = await run("ls");
    expect(result.code).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("broken-zzzzzz.md");
  });
});

describe("task show", () => {
  it("prints the file byte-for-byte", async () => {
    const stem = await addTask("A task to show.");
    const raw = await readFile(path.join(dir, "active", `${stem}.md`), "utf8");
    expect((await run("show", stem)).stdout).toBe(raw);
  });

  it("resolves by id prefix and by filename", async () => {
    const stem = await addTask("A task to show.");
    expect((await run("show", idOf(stem).slice(0, 3))).code).toBe(0);
    expect((await run("show", `${stem}.md`)).code).toBe(0);
  });

  it("includes the body in --json", async () => {
    const stem = await addTask("A task to show.");
    const parsed = JSON.parse((await run("show", stem, "--json")).stdout);
    expect(parsed.body).toContain("## Description");
    expect(parsed.stem).toBe(stem);
  });

  it("exits 1 for an unknown ref", async () => {
    const result = await run("show", "nosuch");
    expect(result.code).toBe(1);
    expect(result.stderr.trim()).toBe('Error: no task matches "nosuch"');
  });
});

describe("status transitions", () => {
  it("runs the full lifecycle and archives at the end", async () => {
    const stem = await addTask("Add retry logic to the refresh path.");
    const id = idOf(stem);
    await setPlan(stem);

    expect((await run("propose", id)).stdout.trim()).toBe(`${stem}: inbox → proposed`);
    expect((await run("accept", id)).stdout.trim()).toBe(`${stem}: proposed → todo`);
    expect((await run("start", id)).stdout.trim()).toBe(`${stem}: todo → in-progress`);
    expect((await run("done", id)).stdout.trim()).toBe(`${stem}: in-progress → done`);

    expect(await readdir(path.join(dir, "active"))).toEqual([]);
    expect(await readdir(path.join(dir, "archive"))).toEqual([`${stem}.md`]);
  });

  it("hides an archived task from ls but still finds it by ref", async () => {
    const stem = await addTask("To be rejected.");
    await run("reject", idOf(stem));

    expect((await run("ls")).stderr.trim()).toBe("No tasks.");
    expect((await run("ls", "--archived")).stdout).toContain("rejected");
    expect((await run("show", idOf(stem))).code).toBe(0);
  });

  it("restores a rejected task to inbox and a done task to todo", async () => {
    const rejected = await addTask("Reject me.");
    await run("reject", idOf(rejected));
    expect((await run("restore", idOf(rejected))).stdout.trim()).toBe(
      `${rejected}: rejected → inbox`,
    );
    expect(await readdir(path.join(dir, "archive"))).toEqual([]);
  });

  it("refuses an invalid transition with the spec's message", async () => {
    const stem = await addTask("Not yet proposed.");
    const result = await run("accept", idOf(stem));
    expect(result.code).toBe(1);
    expect(result.stderr.trim()).toBe(
      `Error: cannot accept ${stem}: status is inbox (expected proposed)`,
    );
  });

  it("refuses to propose a task with an empty Plan", async () => {
    const stem = await addTask("No plan yet.");
    const result = await run("propose", idOf(stem));
    expect(result.code).toBe(1);
    expect(result.stderr.trim()).toBe(`Error: cannot propose ${stem}: Plan section is empty`);
  });

  it("reports the wrong status before complaining about the Plan", async () => {
    const stem = await addTask("Already moving.");
    await setPlan(stem);
    await run("propose", idOf(stem));
    await run("accept", idOf(stem));
    // Now `todo`, and the Plan is non-empty anyway; blank it to be sure.
    const result = await run("propose", idOf(stem));
    expect(result.stderr).toContain("status is todo (expected inbox)");
  });

  it("preserves the Plan and Description across transitions", async () => {
    const stem = await addTask("Keep my plan.");
    await setPlan(stem);
    await run("propose", idOf(stem));
    await run("accept", idOf(stem));
    const raw = await readFile(path.join(dir, "active", `${stem}.md`), "utf8");
    expect(raw).toContain("1. A step");
    expect(raw).toContain("Keep my plan.");
  });
});

describe("interrupted archive", () => {
  it("is hidden by ls and repaired by the next archiving command", async () => {
    const stem = await addTask("Interrupted.");
    // Simulate a crash between the status write and the rename.
    const file = path.join(dir, "active", `${stem}.md`);
    await writeFile(file, (await readFile(file, "utf8")).replace("status: inbox", "status: done"), "utf8");

    expect((await run("ls")).stderr.trim()).toBe("No tasks.");

    const restored = await run("restore", idOf(stem));
    expect(restored.code).toBe(0);
    expect(await readdir(path.join(dir, "active"))).toEqual([`${stem}.md`]);
  });
});

describe("TTY-only commands in a non-TTY shell", () => {
  it("edit refuses", async () => {
    const stem = await addTask("Edit me.");
    const result = await run("edit", idOf(stem));
    expect(result.code).toBe(1);
    expect(result.stderr.trim()).toBe("Error: edit requires an interactive terminal");
  });

  it("review refuses with the spec's hint", async () => {
    const result = await run("review");
    expect(result.code).toBe(1);
    expect(result.stderr.trim()).toBe(
      "Error: review is interactive. Use accept/reject/edit instead.",
    );
  });
});

describe("exit codes and help", () => {
  it("exits 0 for --help and for a subcommand's help", async () => {
    expect((await run("--help")).code).toBe(0);
    expect((await run("add", "--help")).code).toBe(0);
  });

  it("exits 1 for an unknown command", async () => {
    expect((await run("nosuchcommand")).code).toBe(1);
  });

  it("exits 1 when a required argument is missing", async () => {
    expect((await run("show")).code).toBe(1);
  });

  it("creates the data directories on demand", async () => {
    await cleanup(dir);
    await mkdir(dir, { recursive: true });
    await run("ls");
    expect((await readdir(dir)).sort()).toEqual(["active", "archive"]);
  });
});
