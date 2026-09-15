import { UserError } from "../core/errors.js";
import { toIsoUtc } from "../core/body.js";
import { deriveTitle, generateId, slugify, stem as makeStem } from "../core/ids.js";
import { resolveProject } from "../core/project.js";
import { createTaskFile, existingIds } from "../core/storage.js";
import type { Status, Task } from "../core/task.js";
import { toJson } from "./format.js";

export interface AddOptions {
  project?: string;
  proposed?: boolean;
  json?: boolean;
}

/** The body every new task starts with: capture text, then two empty sections. */
function initialBody(description: string): string {
  return `## Description\n${description}\n\n## Plan\n\n## Log\n`;
}

export async function addCommand(description: string, options: AddOptions): Promise<void> {
  const text = description.trim();
  if (text === "") throw new UserError("task description required");

  // Resolve the project before writing anything, so a failure here creates no file.
  const project = resolveProject(options.project);

  const taken = await existingIds();
  let id = generateId();
  while (taken.has(id)) id = generateId();

  const title = deriveTitle(text);
  const status: Status = options.proposed === true ? "proposed" : "inbox";
  const task: Task = { id, title, status, project, created: toIsoUtc() };

  const file = await createTaskFile(task, initialBody(text), makeStem(slugify(title), id));

  if (options.json === true) {
    console.log(JSON.stringify(toJson(file), null, 2));
  } else {
    console.log(`Created ${file.stem}`);
  }
}
