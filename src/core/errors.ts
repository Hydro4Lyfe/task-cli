/**
 * Two error classes map directly onto the spec's exit codes (section 5).
 * Core throws these; `cli/index.ts` is the only place that catches them and
 * the only place that calls `process.exit`.
 */

/** Exit 1: bad arguments, lookup failure, invalid transition, not a repo, no TTY. */
export class UserError extends Error {
  override readonly name = "UserError";
}

/** Exit 2: a task file on disk failed validation. */
export class DataError extends Error {
  override readonly name = "DataError";
}
