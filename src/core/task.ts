/** The task data model (spec section 3). */

export const STATUSES = [
  "inbox",
  "proposed",
  "todo",
  "in-progress",
  "done",
  "rejected",
] as const;

export type Status = (typeof STATUSES)[number];

/** Statuses whose files live in `archive/` rather than `active/`. */
const ARCHIVED_STATUSES = new Set<Status>(["done", "rejected"]);

export function isArchivedStatus(status: Status): boolean {
  return ARCHIVED_STATUSES.has(status);
}

export function isStatus(value: unknown): value is Status {
  return typeof value === "string" && (STATUSES as readonly string[]).includes(value);
}

/**
 * The frontmatter block, exactly. `created` is deliberately a string and never
 * a `Date`: gray-matter's YAML parser coerces unquoted ISO timestamps into
 * `Date` objects and re-serialises them with milliseconds, which would silently
 * rewrite the field on every read/write cycle.
 */
export interface Task {
  id: string;
  title: string;
  status: Status;
  project: string;
  created: string;
}

/** The order frontmatter keys are written in, per the spec's example file. */
export const TASK_FIELDS = ["id", "title", "status", "project", "created"] as const;

/** A task plus where it lives and its filename stem. */
export interface TaskFile {
  task: Task;
  /** Markdown after the frontmatter block. */
  body: string;
  /** Absolute path to the file. */
  path: string;
  /** Filename without the `.md` extension, e.g. `fix-token-refresh-a3f9k2`. */
  stem: string;
  /** Which folder the file is currently in, which may disagree with `status`. */
  folder: "active" | "archive";
}
