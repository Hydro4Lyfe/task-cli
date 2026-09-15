import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { UserError } from "../core/errors.js";
import { parseTaskFile } from "../core/frontmatter.js";
import { resolveRef } from "../core/lookup.js";
import { TASK_FIELDS, type Task } from "../core/task.js";

/** `$VISUAL`, then `$EDITOR`, then `vi` (spec section 4). */
function editorCommand(): string {
  const visual = process.env["VISUAL"];
  if (visual !== undefined && visual.trim() !== "") return visual;
  const editor = process.env["EDITOR"];
  if (editor !== undefined && editor.trim() !== "") return editor;
  return "vi";
}

/** Every frontmatter field is immutable through `edit`; status moves via commands only. */
function changedImmutableField(before: Task, after: Task): string | undefined {
  return TASK_FIELDS.find((field) => before[field] !== after[field]);
}

export async function editCommand(ref: string): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new UserError("edit requires an interactive terminal");
  }

  const file = await resolveRef(ref);
  const original = await readFile(file.path, "utf8");

  const editor = editorCommand();
  const result = spawnSync(editor, [file.path], { stdio: "inherit", shell: true });
  if (result.error !== undefined) {
    throw new UserError(`could not launch editor "${editor}": ${result.error.message}`);
  }

  const edited = await readFile(file.path, "utf8");
  if (edited === original) return;

  // Any problem below is the user's edit, so it is exit 1 and the original
  // bytes go back — a task file is never left in a state the tool cannot read.
  const restore = async (reason: string): Promise<never> => {
    await writeFile(file.path, original, "utf8");
    throw new UserError(`${reason}. ${file.stem} was restored unchanged`);
  };

  let parsed;
  try {
    parsed = parseTaskFile(edited, `${file.stem}.md`);
  } catch (error) {
    return restore(error instanceof Error ? error.message : String(error));
  }

  const changed = changedImmutableField(file.task, parsed.task);
  if (changed !== undefined) {
    return restore(`${changed} is immutable and cannot be changed by edit`);
  }

  console.log(`Updated ${file.stem}`);
}
