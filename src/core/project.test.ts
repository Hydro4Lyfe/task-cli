import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UserError } from "./errors.js";
import { currentProject, repoNameFromUrl, resolveProject } from "./project.js";

describe("repoNameFromUrl", () => {
  it.each([
    ["git@github.com:owner/fantasy-madness.git", "fantasy-madness"],
    ["https://github.com/owner/fantasy-madness.git", "fantasy-madness"],
    ["https://github.com/owner/fantasy-madness", "fantasy-madness"],
    ["ssh://git@github.com:22/owner/fantasy-madness.git", "fantasy-madness"],
    ["https://github.com/owner/fantasy-madness/", "fantasy-madness"],
    ["/srv/git/fantasy-madness.git", "fantasy-madness"],
  ])("takes the repo name from %s", (url, expected) => {
    expect(repoNameFromUrl(url)).toBe(expected);
  });

  it("returns undefined for an empty url", () => {
    expect(repoNameFromUrl("   ")).toBeUndefined();
  });
});

describe("resolveProject", () => {
  let dir: string;
  let cwd: string;

  beforeEach(async () => {
    cwd = process.cwd();
    dir = await mkdtemp(path.join(tmpdir(), "task-cli-git-"));
  });

  afterEach(async () => {
    process.chdir(cwd);
    await rm(dir, { recursive: true, force: true });
  });

  it("prefers an explicit flag over anything git says", () => {
    expect(resolveProject("explicit")).toBe("explicit");
  });

  it("falls back to the toplevel directory name when there is no origin", () => {
    execFileSync("git", ["init", "-q", dir]);
    process.chdir(dir);
    // macOS/WSL temp dirs can be symlinked, so compare against git's own answer.
    const toplevel = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
    expect(resolveProject()).toBe(path.basename(toplevel));
  });

  it("prefers the origin remote name over the directory name", () => {
    execFileSync("git", ["init", "-q", dir]);
    process.chdir(dir);
    execFileSync("git", ["remote", "add", "origin", "git@github.com:owner/renamed-repo.git"]);
    expect(resolveProject()).toBe("renamed-repo");
  });

  it("throws the spec's message outside a repo", () => {
    process.chdir(tmpdir());
    // tmpdir itself must not be a repo for this assertion to mean anything.
    const inRepo = currentProject() !== undefined;
    if (inRepo) return;
    expect(() => resolveProject()).toThrow(UserError);
    expect(() => resolveProject()).toThrow(
      "not in a git repository. Run inside a repo or pass --project <name>.",
    );
  });
});
