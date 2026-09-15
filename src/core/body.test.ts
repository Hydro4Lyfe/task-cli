import { describe, expect, it } from "vitest";
import { appendLog, getSection, isSectionEmpty, missingSections, setSection, toIsoUtc } from "./body.js";

const BASE = "## Description\nCapture text.\n\n## Plan\n\n## Log\n";

describe("missingSections", () => {
  it("reports nothing when all three headings exist", () => {
    expect(missingSections(BASE)).toEqual([]);
  });

  it("reports missing headings in spec order", () => {
    expect(missingSections("## Description\n\n## Log\n")).toEqual(["Plan"]);
    expect(missingSections("## Log\n")).toEqual(["Description", "Plan"]);
  });

  it("treats a lowercase heading as missing", () => {
    expect(missingSections("## Description\n\n## plan\n\n## Log\n")).toEqual(["Plan"]);
  });
});

describe("getSection / isSectionEmpty", () => {
  it("reads content up to the next heading", () => {
    expect(getSection(BASE, "Description")).toBe("Capture text.");
  });

  it("treats a whitespace-only section as empty", () => {
    expect(isSectionEmpty(BASE, "Plan")).toBe(true);
    expect(isSectionEmpty("## Description\n\n## Plan\n   \n\n## Log\n", "Plan")).toBe(true);
  });

  it("keeps sub-headings inside their parent section", () => {
    const body = "## Description\nd\n\n## Plan\n### Step one\ndetail\n\n## Log\n";
    expect(getSection(body, "Plan")).toBe("### Step one\ndetail");
  });

  it("ignores a '## ' line inside a fenced code block", () => {
    const body = "## Description\n```sh\n## Plan\nnot a heading\n```\n\n## Plan\nreal\n\n## Log\n";
    expect(missingSections(body)).toEqual([]);
    expect(getSection(body, "Plan")).toBe("real");
    expect(getSection(body, "Description")).toContain("not a heading");
  });
});

describe("setSection", () => {
  it("replaces one section and leaves the others untouched", () => {
    const next = setSection(BASE, "Plan", "1. Do a thing");
    expect(getSection(next, "Plan")).toBe("1. Do a thing");
    expect(getSection(next, "Description")).toBe("Capture text.");
    expect(missingSections(next)).toEqual([]);
  });

  it("rewrites in place rather than appending, on repeat calls", () => {
    const once = setSection(BASE, "Plan", "first");
    const twice = setSection(once, "Plan", "second");
    expect(getSection(twice, "Plan")).toBe("second");
    expect(twice).not.toContain("first");
  });

  it("can clear a section back to empty", () => {
    const filled = setSection(BASE, "Plan", "something");
    expect(isSectionEmpty(setSection(filled, "Plan", ""), "Plan")).toBe(true);
  });

  it("handles the trailing section without leaving stray blank lines", () => {
    const next = setSection(BASE, "Log", "- entry");
    expect(next.endsWith("- entry\n")).toBe(true);
  });
});

describe("appendLog", () => {
  it("appends an ISO-stamped entry", () => {
    const next = appendLog(BASE, "started work", new Date("2026-09-15T14:02:00.123Z"));
    expect(getSection(next, "Log")).toBe("- 2026-09-15T14:02:00Z — started work");
  });

  it("appends without dropping earlier entries", () => {
    const one = appendLog(BASE, "first", new Date("2026-09-15T14:02:00Z"));
    const two = appendLog(one, "second", new Date("2026-09-15T15:02:00Z"));
    expect(getSection(two, "Log").split("\n")).toHaveLength(2);
    expect(getSection(two, "Log")).toContain("first");
  });
});

describe("toIsoUtc", () => {
  it("emits second precision with no milliseconds", () => {
    expect(toIsoUtc(new Date("2026-09-15T14:02:00.987Z"))).toBe("2026-09-15T14:02:00Z");
  });
});
