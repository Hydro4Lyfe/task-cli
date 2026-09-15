import { readdir } from "node:fs/promises";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { UserError } from "./errors.js";
import { MIN_PREFIX_LENGTH } from "./ids.js";
import { parseTaskFile } from "./frontmatter.js";
import { FOLDERS, ensureDirs, folderPath, type Folder } from "./storage.js";
import type { TaskFile } from "./task.js";

interface Candidate {
  stem: string;
  id: string;
  folder: Folder;
}

/** Every task's stem and id, taken from filenames alone. */
async function candidates(): Promise<Candidate[]> {
  await ensureDirs();
  const found: Candidate[] = [];
  for (const folder of FOLDERS) {
    for (const name of await readdir(folderPath(folder))) {
      if (!name.endsWith(".md")) continue;
      const stem = name.slice(0, -".md".length);
      const dash = stem.lastIndexOf("-");
      found.push({ stem, id: dash === -1 ? stem : stem.slice(dash + 1), folder });
    }
  }
  return found.sort((a, b) => a.stem.localeCompare(b.stem));
}

/**
 * Resolve a `<ref>` to exactly one task (spec section 3, Lookup).
 *
 * Precedence is full stem, then exact id, then unique id prefix of at least
 * three characters. Matching happens on filenames, so an unrelated malformed
 * task file cannot break an otherwise valid lookup; only the file we actually
 * resolve to gets parsed and validated.
 */
export async function resolveRef(rawRef: string): Promise<TaskFile> {
  const ref = normalizeRef(rawRef);
  const all = await candidates();

  const byStem = all.filter((c) => c.stem === ref);
  const byId = all.filter((c) => c.id === ref);
  const byPrefix =
    ref.length >= MIN_PREFIX_LENGTH ? all.filter((c) => c.id.startsWith(ref)) : [];

  const matches = byStem.length > 0 ? byStem : byId.length > 0 ? byId : byPrefix;

  if (matches.length === 0) throw new UserError(`no task matches "${ref}"`);
  if (matches.length > 1) {
    const stems = matches.map((c) => c.stem).join("\n");
    throw new UserError(`"${ref}" matches multiple tasks:\n${stems}`);
  }

  const match = matches[0];
  if (match === undefined) throw new UserError(`no task matches "${ref}"`);
  return read(match);
}

/**
 * Accept what a shell actually hands over. Tab-completing a task yields
 * `fix-thing-a3f9k2.md` or `active/fix-thing-a3f9k2.md`; both should resolve
 * rather than failing on a trailing extension. Ids and slugs are always
 * lowercase, so lowercasing the input can only help.
 */
export function normalizeRef(ref: string): string {
  const base = path.basename(ref.trim());
  return (base.endsWith(".md") ? base.slice(0, -".md".length) : base).toLowerCase();
}

async function read(candidate: Candidate): Promise<TaskFile> {
  const filename = `${candidate.stem}.md`;
  const filePath = path.join(folderPath(candidate.folder), filename);
  const raw = await readFile(filePath, "utf8");
  const { task, body } = parseTaskFile(raw, filename);
  return { task, body, path: filePath, stem: candidate.stem, folder: candidate.folder };
}
