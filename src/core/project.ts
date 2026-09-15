import { execFileSync } from "node:child_process";
import path from "node:path";
import { UserError } from "./errors.js";

function git(args: string[]): string | undefined {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return undefined;
  }
}

/** The repo name from a remote URL: last path segment with `.git` stripped. */
export function repoNameFromUrl(url: string): string | undefined {
  const cleaned = url.trim().replace(/\/+$/, "");
  if (cleaned === "") return undefined;
  // Handles both `git@host:owner/repo.git` and `https://host/owner/repo.git`.
  const segment = cleaned.split(/[/:]/).pop();
  if (segment === undefined || segment === "") return undefined;
  const name = segment.replace(/\.git$/, "");
  return name === "" ? undefined : name;
}

/** True when the current directory is inside a git work tree. */
export function inGitRepo(): boolean {
  return git(["rev-parse", "--is-inside-work-tree"]) === "true";
}

/**
 * Resolve the project name (spec section 3, Project resolution):
 * explicit flag, then the `origin` remote's repo name, then the git toplevel
 * directory name. Preferring the remote keeps the name stable across clones
 * and worktrees, which may sit in differently-named directories.
 */
export function resolveProject(flag?: string): string {
  if (flag !== undefined && flag.trim() !== "") return flag.trim();

  if (inGitRepo()) {
    const remote = git(["remote", "get-url", "origin"]);
    if (remote !== undefined) {
      const name = repoNameFromUrl(remote);
      if (name !== undefined) return name;
    }
    const toplevel = git(["rev-parse", "--show-toplevel"]);
    if (toplevel !== undefined && toplevel !== "") return path.basename(toplevel);
  }

  throw new UserError("not in a git repository. Run inside a repo or pass --project <name>.");
}

/** Like `resolveProject`, but returns undefined instead of throwing. */
export function currentProject(): string | undefined {
  try {
    return resolveProject();
  } catch {
    return undefined;
  }
}
