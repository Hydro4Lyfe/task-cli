import matter from "gray-matter";
import { DataError } from "./errors.js";
import { validateBody, validateFrontmatter } from "./validate.js";
import { TASK_FIELDS, type Task } from "./task.js";

/**
 * Parse a task file into validated frontmatter plus its raw body.
 * `filename` is only used to build error messages.
 */
export function parseTaskFile(raw: string, filename: string): { task: Task; body: string } {
  let parsed: matter.GrayMatterFile<string>;
  try {
    // The options argument is not optional in practice: calling `matter(raw)`
    // hits a module-level cache that returns a shallow copy sharing the same
    // `.data` object, so a mutation anywhere would poison every later parse of
    // identical content. Passing `{}` bypasses the cache entirely.
    parsed = matter(raw, {});
  } catch (error) {
    // A malformed YAML block is a data problem, not a crash.
    const reason = error instanceof Error ? error.message.split("\n")[0] : String(error);
    throw new DataError(`${filename}: frontmatter is not valid YAML (${reason})`);
  }

  const task = validateFrontmatter(filename, parsed.data as Record<string, unknown>);
  validateBody(filename, parsed.content);
  return { task, body: parsed.content };
}

/**
 * Serialize a task back to file contents.
 *
 * This always goes through `matter.stringify` rather than string concatenation:
 * titles are derived from arbitrary capture text, so a title containing `: `
 * (`Fix bug: token refresh`) is routine, and writing it unquoted would produce
 * a file that no longer parses. gray-matter quotes it correctly, preserves key
 * order, and — because `created` is held as a string — writes the timestamp
 * quoted so it reads back as a string rather than a `Date`.
 */
export function serializeTaskFile(task: Task, body: string): string {
  // Rebuild the object field-by-field so key order always matches the spec.
  const data: Record<string, string> = {};
  for (const field of TASK_FIELDS) data[field] = task[field];
  return matter.stringify(body, data);
}
