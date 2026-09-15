import { UserError } from "../core/errors.js";
import { isSectionEmpty } from "../core/body.js";
import { resolveRef } from "../core/lookup.js";
import { saveTaskFile } from "../core/storage.js";
import { nextStatus, type TransitionCommand } from "../core/transitions.js";
import type { TaskFile } from "../core/task.js";

/**
 * All six status commands share this path, so `review` and the standalone
 * commands cannot drift apart (spec section 4, `task review`).
 */
export async function applyTransition(
  command: TransitionCommand,
  ref: string,
): Promise<{ file: TaskFile; line: string }> {
  const file = await resolveRef(ref);

  const from = file.task.status;

  // Status is checked first: proposing a `todo` task is a wrong-status error,
  // not a complaint about its Plan.
  const to = nextStatus(command, file.task, file.stem);

  // The one command with an extra precondition beyond the transition table.
  if (command === "propose" && isSectionEmpty(file.body, "Plan")) {
    throw new UserError(`cannot propose ${file.stem}: Plan section is empty`);
  }

  // saveTaskFile writes the new status first, then relocates between
  // active/ and archive/ — the order the spec requires for atomicity.
  const updated = await saveTaskFile({ ...file, task: { ...file.task, status: to } });

  return { file: updated, line: `${updated.stem}: ${from} → ${to}` };
}

export async function statusCommand(command: TransitionCommand, ref: string): Promise<void> {
  const { line } = await applyTransition(command, ref);
  console.log(line);
}
