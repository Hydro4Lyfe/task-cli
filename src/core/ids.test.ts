import { describe, expect, it } from "vitest";
import { deriveTitle, generateId, isValidId, slugify, stem } from "./ids.js";

describe("deriveTitle", () => {
  it("stops at the first sentence terminator followed by whitespace", () => {
    expect(
      deriveTitle("Fix token refresh failing after laptop sleep. Happens when the token expires."),
    ).toBe("Fix token refresh failing after laptop sleep");
  });

  it("stops at the first newline when that comes first", () => {
    expect(deriveTitle("Short heading\nA much longer body sentence. More.")).toBe("Short heading");
  });

  it("treats ! and ? as terminators", () => {
    expect(deriveTitle("It crashes! Every time.")).toBe("It crashes");
    expect(deriveTitle("Why does it crash? Unclear.")).toBe("Why does it crash");
  });

  it("does not split on a dot that is not followed by whitespace", () => {
    expect(deriveTitle("Upgrade to v1.2.3 across the board")).toBe(
      "Upgrade to v1.2.3 across the board",
    );
  });

  it("keeps a trailing terminator at end of string, since nothing follows it", () => {
    expect(deriveTitle("Add retry logic.")).toBe("Add retry logic.");
  });

  it("cuts at the last space at or before char 60", () => {
    const title = deriveTitle(`${"a".repeat(55)} bbbbbbbbbb cccc`);
    expect(title).toBe("a".repeat(55));
    expect(title.length).toBeLessThanOrEqual(60);
  });

  it("hard-cuts at 60 when there is no space to cut at", () => {
    expect(deriveTitle("x".repeat(80))).toBe("x".repeat(60));
  });

  it("trims surrounding whitespace first", () => {
    expect(deriveTitle("   padded title   ")).toBe("padded title");
  });
});

describe("slugify", () => {
  it("reproduces the worked example from the spec", () => {
    const title = deriveTitle(
      "Fix token refresh failing after laptop sleep. Happens when the access token expires.",
    );
    expect(stem(slugify(title), "a3f9k2")).toBe("fix-token-refresh-failing-after-laptop-a3f9k2");
  });

  it("collapses runs of non-alphanumerics into one dash", () => {
    expect(slugify("Fix bug: token  refresh -- #4!")).toBe("fix-bug-token-refresh-4");
  });

  it("trims leading and trailing dashes", () => {
    expect(slugify("...leading and trailing...")).toBe("leading-and-trailing");
  });

  it("caps at 40 chars, cutting at a dash boundary", () => {
    const slug = slugify("alpha bravo charlie delta echo foxtrot golf hotel");
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug).toBe("alpha-bravo-charlie-delta-echo-foxtrot");
    expect(slug.endsWith("-")).toBe(false);
  });

  it("hard-cuts at 40 when a single word exceeds it", () => {
    expect(slugify("z".repeat(50))).toBe("z".repeat(40));
  });

  it("falls back to 'task' when nothing sluggable remains", () => {
    expect(slugify("!!! ??? ...")).toBe("task");
  });
});

describe("generateId", () => {
  it("produces 6-char lowercase base36 ids", () => {
    for (let i = 0; i < 200; i++) {
      const id = generateId();
      expect(id).toMatch(/^[0-9a-z]{6}$/);
      expect(isValidId(id)).toBe(true);
    }
  });

  it("rejects malformed ids", () => {
    expect(isValidId("abc")).toBe(false);
    expect(isValidId("ABCDEF")).toBe(false);
    expect(isValidId("abcdefg")).toBe(false);
  });
});
