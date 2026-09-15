import { describe, expect, it } from "vitest";
import { UserError } from "./errors.js";
import { allowedFrom, nextStatus, TRANSITION_COMMANDS } from "./transitions.js";
import { STATUSES, type Status, type Task } from "./task.js";

const task = (status: Status): Task => ({
  id: "a3f9k2",
  title: "T",
  status,
  project: "p",
  created: "2026-09-15T14:02:00Z",
});

/** Every legal transition from the spec's table. */
const LEGAL: [string, Status, Status][] = [
  ["propose", "inbox", "proposed"],
  ["accept", "proposed", "todo"],
  ["reject", "inbox", "rejected"],
  ["reject", "proposed", "rejected"],
  ["start", "todo", "in-progress"],
  ["done", "in-progress", "done"],
  ["restore", "done", "todo"],
  ["restore", "rejected", "inbox"],
];

describe("nextStatus", () => {
  it.each(LEGAL)("%s: %s → %s", (command, from, to) => {
    expect(nextStatus(command as never, task(from), "stem")).toBe(to);
  });

  it("rejects every combination outside the table", () => {
    const legal = new Set(LEGAL.map(([c, f]) => `${c}:${f}`));
    for (const command of TRANSITION_COMMANDS) {
      for (const status of STATUSES) {
        if (legal.has(`${command}:${status}`)) continue;
        expect(() => nextStatus(command, task(status), "stem")).toThrow(UserError);
      }
    }
  });

  it("uses the spec's error wording", () => {
    expect(() => nextStatus("accept", task("inbox"), "my-task-a3f9k2")).toThrow(
      "cannot accept my-task-a3f9k2: status is inbox (expected proposed)",
    );
  });

  it("lists every allowed source status in the message", () => {
    expect(() => nextStatus("reject", task("todo"), "s")).toThrow("(expected inbox, proposed)");
  });
});

describe("allowedFrom", () => {
  it("covers both branches of restore", () => {
    expect(allowedFrom("restore")).toEqual(["done", "rejected"]);
  });
});
