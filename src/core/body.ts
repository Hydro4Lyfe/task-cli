/**
 * Reading and rewriting the `## Description` / `## Plan` / `## Log` sections
 * (spec section 3, Body structure).
 *
 * Sections are manipulated as raw text rather than through a markdown AST.
 * That is safe because gray-matter round-trips the body byte-for-byte, and it
 * keeps whatever formatting the human or Claude wrote completely untouched.
 */

export const SECTIONS = ["Description", "Plan", "Log"] as const;
export type SectionName = (typeof SECTIONS)[number];

interface Section {
  name: string;
  /** Index of the heading line. */
  headingLine: number;
  /** First line of content, i.e. `headingLine + 1`. */
  contentStart: number;
  /** Exclusive end of content: the next `## ` heading, or end of body. */
  contentEnd: number;
}

/**
 * Locate every level-2 heading, ignoring any that sit inside a fenced code
 * block — a plan containing a shell snippet with `## ` in it must not be
 * mistaken for a new section.
 */
function findSections(body: string): Section[] {
  const lines = body.split("\n");
  const headings: { name: string; line: number }[] = [];
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = /^##[ \t]+(.+?)[ \t]*$/.exec(line);
    if (match?.[1] !== undefined) headings.push({ name: match[1], line: i });
  }

  return headings.map((heading, index) => ({
    name: heading.name,
    headingLine: heading.line,
    contentStart: heading.line + 1,
    contentEnd: headings[index + 1]?.line ?? lines.length,
  }));
}

/** Names of the level-2 headings present, in order. */
export function sectionNames(body: string): string[] {
  return findSections(body).map((s) => s.name);
}

/** Which of the three required headings are missing, if any. */
export function missingSections(body: string): SectionName[] {
  const present = new Set(sectionNames(body));
  return SECTIONS.filter((name) => !present.has(name));
}

/** The raw content under a heading, trailing blank lines trimmed. */
export function getSection(body: string, name: SectionName): string {
  const section = findSections(body).find((s) => s.name === name);
  if (section === undefined) return "";
  return body.split("\n").slice(section.contentStart, section.contentEnd).join("\n").trim();
}

/** True when a section holds nothing but whitespace. */
export function isSectionEmpty(body: string, name: SectionName): boolean {
  return getSection(body, name) === "";
}

/**
 * Replace a section's content in place, leaving every other section byte-identical.
 * Used for `## Plan`, which the spec says is rewritten rather than appended to.
 */
export function setSection(body: string, name: SectionName, content: string): string {
  const section = findSections(body).find((s) => s.name === name);
  if (section === undefined) {
    throw new Error(`section "${name}" not found`);
  }

  const lines = body.split("\n");
  const trimmed = content.trim();
  // The leading and trailing blank entries give one blank line after the
  // heading and one before whatever follows — or, for the final section, the
  // file's terminating newline.
  const replacement = trimmed === "" ? [""] : ["", ...trimmed.split("\n"), ""];

  return [
    ...lines.slice(0, section.contentStart),
    ...replacement,
    ...lines.slice(section.contentEnd),
  ].join("\n");
}

/** Append one `- <ISO 8601 UTC> — <text>` entry to `## Log`. */
export function appendLog(body: string, text: string, now: Date = new Date()): string {
  const entry = `- ${toIsoUtc(now)} — ${text}`;
  const existing = getSection(body, "Log");
  return setSection(body, "Log", existing === "" ? entry : `${existing}\n${entry}`);
}

/** ISO 8601 UTC with second precision and no milliseconds, e.g. `2026-09-15T14:02:00Z`. */
export function toIsoUtc(date: Date = new Date()): string {
  return `${date.toISOString().slice(0, 19)}Z`;
}
