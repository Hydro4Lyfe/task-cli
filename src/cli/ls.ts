import { UserError } from "../core/errors.js";
import { currentProject } from "../core/project.js";
import { folderForStatus, listTaskFiles, type Folder } from "../core/storage.js";
import { STATUSES, isStatus, type TaskFile } from "../core/task.js";
import { formatFooter, formatTable, toJson } from "./format.js";

export interface LsOptions {
  all?: boolean;
  archived?: boolean;
  status?: string;
  json?: boolean;
}

export async function lsCommand(options: LsOptions): Promise<void> {
  if (options.status !== undefined && !isStatus(options.status)) {
    throw new UserError(`invalid status "${options.status}" (expected ${STATUSES.join(", ")})`);
  }

  const folder: Folder = options.archived === true ? "archive" : "active";
  let files = await listTaskFiles(folder);

  // A done/rejected file still in active/ is an interrupted archive: hide it
  // rather than showing a task in a folder it has already logically left.
  // Deriving the test from the status covers the mirror case too.
  files = files.filter((file) => folderForStatus(file.task) === folder);

  if (options.status !== undefined) {
    const wanted = options.status;
    files = files.filter((file) => file.task.status === wanted);
  }

  // Outside a git repo there is no project to scope to, so listing everything
  // is the useful behaviour — listing, unlike capture, needs no project.
  const project = options.all === true ? undefined : currentProject();

  let shown: TaskFile[] = files;
  if (project !== undefined) {
    shown = files.filter((file) => file.task.project === project);
  }

  if (options.json === true) {
    console.log(JSON.stringify(shown.map(toJson), null, 2));
    return;
  }

  if (shown.length === 0) {
    console.error("No tasks.");
    return;
  }

  console.log(formatTable(shown));

  if (project !== undefined) {
    console.error(formatFooter(shown.length, project, files.length - shown.length));
  }
}
