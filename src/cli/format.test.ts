import { describe, expect, it } from "vitest";
import { formatAge, formatFooter, formatTable, toJson } from "./format.js";
import type { TaskFile } from "../core/task.js";

const NOW = new Date("2026-09-15T12:00:00Z");
const ago = (ms: number): string => new Date(NOW.getTime() - ms).toISOString();

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const file = (over: Partial<TaskFile["task"]> & { stem?: string } = {}): TaskFile => ({
  task: {
    id: over.id ?? "a3f9k2",
    title: over.title ?? "A title",
    status: over.status ?? "inbox",
    project: over.project ?? "proj",
    created: over.created ?? ago(3 * DAY),
  },
  body: "",
  path: "/tmp/x.md",
  stem: over.stem ?? "a-title-a3f9k2",
  folder: "active",
});

describe("formatAge", () => {
  it.each([
    [0, "0m"],
    [45 * MINUTE, "45m"],
    [59 * MINUTE, "59m"],
    [HOUR, "1h"],
    [5 * HOUR, "5h"],
    [23 * HOUR + 59 * MINUTE, "23h"],
    [DAY, "1d"],
    [3 * DAY, "3d"],
  ])("renders %ims as %s", (offset, expected) => {
    expect(formatAge(ago(offset), NOW)).toBe(expected);
  });

  it("clamps a future timestamp to 0m rather than going negative", () => {
    expect(formatAge(new Date(NOW.getTime() + HOUR).toISOString(), NOW)).toBe("0m");
  });
});

describe("formatTable", () => {
  it("prints the spec's columns and pads to the widest cell", () => {
    const out = formatTable([file({ title: "Short" }), file({ title: "A much longer title" })], NOW);
    const lines = out.split("\n");
    expect(lines[0]).toMatch(/^ID\s+STATUS\s+TITLE\s+PROJECT\s+AGE$/);
    expect(lines).toHaveLength(3);
    // TITLE column is padded to the longer of the two titles.
    expect(lines[1]?.indexOf("proj")).toBe(lines[2]?.indexOf("proj"));
  });

  it("leaves no trailing whitespace on any line", () => {
    for (const line of formatTable([file()], NOW).split("\n")) {
      expect(line).toBe(line.trimEnd());
    }
  });
});

describe("formatFooter", () => {
  it("matches the spec's example", () => {
    expect(formatFooter(3, "fantasy-madness", 7)).toBe(
      "3 tasks in fantasy-madness · 7 in other projects (--all)",
    );
  });

  it("singularises one task", () => {
    expect(formatFooter(1, "p", 0)).toBe("1 task in p · 0 in other projects (--all)");
  });
});

describe("toJson", () => {
  it("is the frontmatter fields plus stem, and nothing else", () => {
    expect(Object.keys(toJson(file()))).toEqual([
      "id",
      "title",
      "status",
      "project",
      "created",
      "stem",
    ]);
  });
});
