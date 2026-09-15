import { UserError } from "./errors.js";
import type { Status, Task } from "./task.js";

/** The commands that change status (spec section 3, Status transitions). */
export const TRANSITION_COMMANDS = [
  "propose",
  "accept",
  "reject",
  "start",
  "done",
  "restore",
] as const;

export type TransitionCommand = (typeof TRANSITION_COMMANDS)[number];

/**
 * The transition table, verbatim from the spec. `restore` is the only command
 * whose target depends on where it started: done -> todo, rejected -> inbox.
 */
const TABLE: Record<TransitionCommand, { from: Status; to: Status }[]> = {
  propose: [{ from: "inbox", to: "proposed" }],
  accept: [{ from: "proposed", to: "todo" }],
  reject: [
    { from: "inbox", to: "rejected" },
    { from: "proposed", to: "rejected" },
  ],
  start: [{ from: "todo", to: "in-progress" }],
  done: [{ from: "in-progress", to: "done" }],
  restore: [
    { from: "done", to: "todo" },
    { from: "rejected", to: "inbox" },
  ],
};

/** Statuses a command may be applied to. */
export function allowedFrom(command: TransitionCommand): Status[] {
  return TABLE[command].map((rule) => rule.from);
}

/**
 * Compute the new status, or throw the spec's invalid-transition error.
 * Actor rules (who may run which command) are enforced by the Claude skill,
 * not here — see spec section 3.
 */
export function nextStatus(command: TransitionCommand, task: Task, stem: string): Status {
  const rule = TABLE[command].find((r) => r.from === task.status);
  if (rule === undefined) {
    const expected = allowedFrom(command).join(", ");
    throw new UserError(
      `cannot ${command} ${stem}: status is ${task.status} (expected ${expected})`,
    );
  }
  return rule.to;
}
