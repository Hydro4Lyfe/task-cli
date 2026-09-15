import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { parseTaskFile, serializeTaskFile } from "./frontmatter.js";
import { isArchivedStatus, type Task, type TaskFile } from "./task.js";

export type Folder = "active" | "archive";
export const FOLDERS: readonly Folder[] = ["active", "archive"];

/** Storage root: `~/tasks`, overridable with `TASKS_DIR` (spec section 3). */
export function tasksRoot(): string {
  const override = process.env["TASKS_DIR"];
  if (override !== undefined && override.trim() !== "") return path.resolve(override);
  return path.join(homedir(), "tasks");
}

export function folderPath(folder: Folder): string {
  return path.join(tasksRoot(), folder);
}

/** Root and subfolders are created on demand. */
export async function ensureDirs(): Promise<void> {
  for (const folder of FOLDERS) {
    await mkdir(folderPath(folder), { recursive: true });
  }
}

/** The folder a task belongs in, derived from its status. */
export function folderForStatus(task: Task): Folder {
  return isArchivedStatus(task.status) ? "archive" : "active";
}

async function readOne(folder: Folder, filename: string): Promise<TaskFile> {
  const filePath = path.join(folderPath(folder), filename);
  const raw = await readFile(filePath, "utf8");
  const { task, body } = parseTaskFile(raw, filename);
  return { task, body, path: filePath, stem: filename.slice(0, -".md".length), folder };
}

/**
 * Every `.md` file in a folder, oldest first by `created`.
 * Every file is validated as it is read, so an invalid file fails the whole
 * command loudly (spec section 5) rather than being skipped.
 */
export async function listTaskFiles(folder: Folder): Promise<TaskFile[]> {
  await ensureDirs();
  const entries = await readdir(folderPath(folder));
  const names = entries.filter((name) => name.endsWith(".md")).sort();

  const files: TaskFile[] = [];
  for (const name of names) {
    files.push(await readOne(folder, name));
  }
  return files.sort(byCreated);
}

/** Oldest first, with a stem tie-break so same-second tasks order deterministically. */
function byCreated(a: TaskFile, b: TaskFile): number {
  return a.task.created.localeCompare(b.task.created) || a.stem.localeCompare(b.stem);
}

/** Every task across both folders. */
export async function listAllTaskFiles(): Promise<TaskFile[]> {
  const all = [...(await listTaskFiles("active")), ...(await listTaskFiles("archive"))];
  return all.sort(byCreated);
}

/** Write a task's contents back to the path it already occupies. */
export async function writeTaskFile(file: TaskFile): Promise<void> {
  await writeFile(file.path, serializeTaskFile(file.task, file.body), "utf8");
}

/**
 * Persist a task, then move it into the folder its status requires.
 *
 * The order matters and is specified: write the status in place first, then
 * rename. A rename within the same filesystem is atomic, so an interruption can
 * only ever leave a correctly-labelled file in the wrong folder — which `ls`
 * hides and the next archiving command repairs. Doing it the other way round
 * could leave a file whose status and location disagree with no way to tell
 * which is right.
 */
export async function saveTaskFile(file: TaskFile): Promise<TaskFile> {
  await writeTaskFile(file);
  return relocate(file);
}

/** Move a file into the folder matching its status, if it is not there already. */
export async function relocate(file: TaskFile): Promise<TaskFile> {
  const target = folderForStatus(file.task);
  if (target === file.folder) return file;

  const newPath = path.join(folderPath(target), `${file.stem}.md`);
  await mkdir(folderPath(target), { recursive: true });
  await rename(file.path, newPath);
  return { ...file, path: newPath, folder: target };
}

/** Create a brand-new task file in `active/`. */
export async function createTaskFile(task: Task, body: string, stem: string): Promise<TaskFile> {
  await ensureDirs();
  const folder = folderForStatus(task);
  const filePath = path.join(folderPath(folder), `${stem}.md`);
  await writeFile(filePath, serializeTaskFile(task, body), "utf8");
  return { task, body, path: filePath, stem, folder };
}

/** Ids already taken across both folders, used to keep generated ids unique. */
export async function existingIds(): Promise<Set<string>> {
  await ensureDirs();
  const ids = new Set<string>();
  for (const folder of FOLDERS) {
    for (const name of await readdir(folderPath(folder))) {
      if (!name.endsWith(".md")) continue;
      // The id is the trailing `-<id>` of the stem; no need to parse the file.
      const stem = name.slice(0, -".md".length);
      const dash = stem.lastIndexOf("-");
      if (dash !== -1) ids.add(stem.slice(dash + 1));
    }
  }
  return ids;
}
