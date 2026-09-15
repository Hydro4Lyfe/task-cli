import { DataError } from "./errors.js";
import { isValidId } from "./ids.js";
import { missingSections } from "./body.js";
import { STATUSES, TASK_FIELDS, isStatus, type Task } from "./task.js";

/**
 * Validation of a file already on disk (spec section 5). Every failure is a
 * `DataError` -> exit 2, with the spec's `<filename>: <field> <problem>` shape.
 * The `Error: ` prefix is added once, by the CLI's top-level handler.
 */
function fail(filename: string, field: string, problem: string): never {
  throw new DataError(`${filename}: ${field} ${problem}`);
}

/** ISO 8601 UTC, second precision, `Z`-suffixed — the form we write. */
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

function requireString(filename: string, field: string, value: unknown): string {
  // A `Date` here means the YAML had an unquoted timestamp. We never write
  // that form, so it only appears after a hand edit — and silently accepting
  // it would rewrite `created` with millisecond precision on the next save.
  if (value instanceof Date) {
    fail(filename, field, "must be a quoted string, not a bare YAML timestamp");
  }
  if (typeof value !== "string") {
    fail(filename, field, `must be a string (got ${value === null ? "null" : typeof value})`);
  }
  if (value.trim() === "") fail(filename, field, "must not be empty");
  return value;
}

/**
 * Validate a parsed frontmatter object and narrow it to a `Task`.
 * Unknown fields are an error, per spec section 3.
 */
export function validateFrontmatter(filename: string, data: Record<string, unknown>): Task {
  const known = new Set<string>(TASK_FIELDS);
  for (const key of Object.keys(data)) {
    if (!known.has(key)) fail(filename, key, "is not a known field");
  }
  for (const field of TASK_FIELDS) {
    if (!(field in data)) fail(filename, field, "is missing");
  }

  const id = requireString(filename, "id", data["id"]);
  if (!isValidId(id)) fail(filename, "id", "must be 6 lowercase base36 characters");

  const title = requireString(filename, "title", data["title"]);
  const project = requireString(filename, "project", data["project"]);

  const status = requireString(filename, "status", data["status"]);
  if (!isStatus(status)) {
    fail(filename, "status", `must be one of ${STATUSES.join(", ")}`);
  }

  const created = requireString(filename, "created", data["created"]);
  if (!ISO_UTC.test(created)) fail(filename, "created", "must be an ISO 8601 UTC timestamp");

  return { id, title, status, project, created };
}

/** All three headings must exist; their content may be empty. */
export function validateBody(filename: string, body: string): void {
  const missing = missingSections(body);
  const first = missing[0];
  if (first !== undefined) fail(filename, "body", `is missing the "## ${first}" heading`);
}
