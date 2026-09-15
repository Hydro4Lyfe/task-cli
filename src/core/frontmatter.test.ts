import { describe, expect, it } from "vitest";
import { DataError } from "./errors.js";
import { parseTaskFile, serializeTaskFile } from "./frontmatter.js";
import type { Task } from "./task.js";

const TASK: Task = {
  id: "a3f9k2",
  title: "Fix token refresh",
  status: "inbox",
  project: "fantasy-madness",
  created: "2026-09-15T14:02:00Z",
};

const BODY = "## Description\nSomething broke.\n\n## Plan\n\n## Log\n";

/** Build a file with one frontmatter line replaced or added. */
function fileWith(lines: string): string {
  return `---\n${lines}---\n${BODY}`;
}

const VALID_LINES =
  "id: a3f9k2\ntitle: T\nstatus: inbox\nproject: p\ncreated: '2026-09-15T14:02:00Z'\n";

describe("serializeTaskFile", () => {
  it("writes fields in the spec's order", () => {
    const out = serializeTaskFile(TASK, BODY);
    const keys = out.split("---")[1]?.trim().split("\n").map((l) => l.split(":")[0]);
    expect(keys).toEqual(["id", "title", "status", "project", "created"]);
  });

  it("quotes a title containing a colon so the file still parses", () => {
    const task = { ...TASK, title: "Fix bug: token refresh fails #4" };
    const out = serializeTaskFile(task, BODY);
    expect(out).toContain("title: 'Fix bug: token refresh fails #4'");
    expect(parseTaskFile(out, "f.md").task.title).toBe(task.title);
  });

  it("keeps created a string, with no millisecond drift", () => {
    const out = serializeTaskFile(TASK, BODY);
    expect(out).toContain("created: '2026-09-15T14:02:00Z'");
    const back = parseTaskFile(out, "f.md");
    expect(typeof back.task.created).toBe("string");
    expect(back.task.created).toBe(TASK.created);
  });

  it("survives repeated round-trips unchanged", () => {
    const once = serializeTaskFile(TASK, BODY);
    const twice = serializeTaskFile(parseTaskFile(once, "f.md").task, parseTaskFile(once, "f.md").body);
    expect(twice).toBe(once);
  });

  it("preserves a body containing code fences and a horizontal rule", () => {
    const body = "## Description\nd\n\n## Plan\n```ts\nconst x = 1;\n```\n\n---\n\n## Log\n";
    expect(parseTaskFile(serializeTaskFile(TASK, body), "f.md").body).toBe(body);
  });
});

describe("parseTaskFile validation", () => {
  it("accepts a well-formed file", () => {
    expect(parseTaskFile(fileWith(VALID_LINES), "f.md").task.id).toBe("a3f9k2");
  });

  it.each([
    ["unknown field", `${VALID_LINES}extra: x\n`, "f.md: extra is not a known field"],
    ["missing field", "id: a3f9k2\ntitle: T\nstatus: inbox\nproject: p\n", "f.md: created is missing"],
    ["bad status", VALID_LINES.replace("inbox", "nope"), "f.md: status must be one of"],
    ["short id", VALID_LINES.replace("a3f9k2", "abc"), "f.md: id must be 6 lowercase base36"],
    ["uppercase id", VALID_LINES.replace("a3f9k2", "A3F9K2"), "f.md: id must be 6 lowercase base36"],
    ["empty title", VALID_LINES.replace("title: T", "title: ''"), "f.md: title must not be empty"],
    [
      "bare yaml date",
      VALID_LINES.replace("'2026-09-15T14:02:00Z'", "2026-09-15T14:02:00Z"),
      "f.md: created must be a quoted string",
    ],
    [
      "non-iso created",
      VALID_LINES.replace("'2026-09-15T14:02:00Z'", "'yesterday'"),
      "f.md: created must be an ISO 8601 UTC timestamp",
    ],
  ])("rejects %s", (_label, lines, expected) => {
    expect(() => parseTaskFile(fileWith(lines), "f.md")).toThrow(DataError);
    expect(() => parseTaskFile(fileWith(lines), "f.md")).toThrow(expected);
  });

  it("rejects a numeric id rather than crashing on the type", () => {
    const lines = VALID_LINES.replace("a3f9k2", "123456");
    expect(() => parseTaskFile(fileWith(lines), "f.md")).toThrow("f.md: id must be a string");
  });

  it("rejects malformed YAML as a data error", () => {
    const broken = "---\ntitle: Fix: token refresh\n---\n";
    expect(() => parseTaskFile(broken, "f.md")).toThrow(DataError);
    expect(() => parseTaskFile(broken, "f.md")).toThrow("frontmatter is not valid YAML");
  });

  it("reports a missing body heading", () => {
    const noPlan = `---\n${VALID_LINES}---\n## Description\nd\n\n## Log\n`;
    expect(() => parseTaskFile(noPlan, "f.md")).toThrow('f.md: body is missing the "## Plan" heading');
  });

  it("reports a missing id for an empty frontmatter block", () => {
    expect(() => parseTaskFile(`---\n---\n${BODY}`, "f.md")).toThrow("f.md: id is missing");
  });
});
