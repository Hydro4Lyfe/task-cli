import { randomInt } from "node:crypto";

const BASE36 = "0123456789abcdefghijklmnopqrstuvwxyz";
const ID_LENGTH = 6;
const MAX_SLUG_LENGTH = 40;
const MAX_TITLE_LENGTH = 60;

/** Minimum length for an id-prefix lookup (spec section 3, Lookup). */
export const MIN_PREFIX_LENGTH = 3;

/** Used when a description contains nothing sluggable (e.g. all punctuation). */
const SLUG_FALLBACK = "task";

/** A random 6-char lowercase base36 id. Uniqueness is enforced by the caller. */
export function generateId(): string {
  let id = "";
  for (let i = 0; i < ID_LENGTH; i++) {
    id += BASE36[randomInt(BASE36.length)];
  }
  return id;
}

export function isValidId(value: string): boolean {
  return new RegExp(`^[0-9a-z]{${ID_LENGTH}}$`).test(value);
}

/**
 * Derive the title from the capture text (spec section 3, Title derivation).
 *
 * The first sentence ends at the first newline, or at the first `.` `!` `?`
 * that is *followed by whitespace* — whichever comes first. The
 * "followed by whitespace" rule is what stops `v1.2` and a trailing full stop
 * at the end of the string from being treated as terminators.
 */
export function deriveTitle(description: string): string {
  const text = description.trim();

  let end = text.length;
  const newline = text.indexOf("\n");
  if (newline !== -1) end = newline;

  for (let i = 0; i < end; i++) {
    const ch = text[i];
    if (ch !== "." && ch !== "!" && ch !== "?") continue;
    const next = text[i + 1];
    // `next === undefined` means end-of-string, which is not a terminator.
    if (next !== undefined && /\s/.test(next)) {
      end = i;
      break;
    }
  }

  const sentence = text.slice(0, end).trim();
  if (sentence.length <= MAX_TITLE_LENGTH) return sentence;

  // Too long: cut at the last space at or before char 60, else hard-cut.
  const window = sentence.slice(0, MAX_TITLE_LENGTH);
  const lastSpace = window.lastIndexOf(" ");
  return lastSpace > 0 ? window.slice(0, lastSpace).trimEnd() : window;
}

/**
 * Slugify a title (spec section 3, Identifiers): lowercase, runs of
 * non-alphanumerics collapse to a single `-`, trimmed, max 40 chars cut at a
 * `-` boundary where possible.
 */
export function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (base === "") return SLUG_FALLBACK;
  if (base.length <= MAX_SLUG_LENGTH) return base;

  const window = base.slice(0, MAX_SLUG_LENGTH);
  const lastDash = window.lastIndexOf("-");
  const cut = lastDash > 0 ? window.slice(0, lastDash) : window;
  return cut.replace(/-+$/g, "");
}

/** The filename stem: `<slug>-<id>`. Fixed at creation, never renamed. */
export function stem(slug: string, id: string): string {
  return `${slug}-${id}`;
}
