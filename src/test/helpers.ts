import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const entry = path.join(repoRoot, "src", "cli", "index.ts");
const tsx = path.join(repoRoot, "node_modules", ".bin", "tsx");

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Create an isolated tasks root for one test. */
export async function makeTasksDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "task-cli-test-"));
}

export async function cleanup(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

/**
 * Invoke the real CLI as a child process so exit codes and the stdout/stderr
 * split are exercised exactly as a user would see them.
 *
 * `cwd` defaults to the repo, which is a git repo — that is what makes the
 * project-resolution path behave normally in tests.
 */
export async function cli(
  args: string[],
  options: { tasksDir: string; cwd?: string; env?: Record<string, string> },
): Promise<CliResult> {
  try {
    const { stdout, stderr } = await run(tsx, [entry, ...args], {
      cwd: options.cwd ?? repoRoot,
      env: {
        ...process.env,
        TASKS_DIR: options.tasksDir,
        ...options.env,
      },
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}
