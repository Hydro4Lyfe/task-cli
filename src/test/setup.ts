import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll } from "vitest";

/**
 * A hard safety net. Tests pass an explicit `TASKS_DIR`, but if any code path
 * ever falls back to the default `~/tasks`, `HOME` points at a throwaway
 * directory for the duration of the run — so a test can never read or write
 * the real task data.
 */
beforeAll(async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "task-cli-home-"));
  delete process.env["TASKS_DIR"];
  process.env["HOME"] = sandbox;
  process.env["USERPROFILE"] = sandbox;
});
