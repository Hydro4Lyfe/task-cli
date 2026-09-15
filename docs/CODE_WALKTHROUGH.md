# task-cli: a code walkthrough

This document walks through every module in `src/`, in the order that makes
them easiest to understand rather than the order they were written. Each
section says what the code does, why it does it that way, and — where the
repo's TypeScript settings force a particular shape — what the compiler was
objecting to.

`docs/SPECV1.md` is the authority on *behaviour*. This document is about
*implementation*: the decisions the spec left open, and the traps that only
show up once you start writing the code.

**Reading order.** Sections 1–3 are the map. Sections 4–13 are `src/core`,
bottom-up, so nothing refers forward to something you have not seen. Sections
14–19 are `src/cli`. Section 20 is the tests, and section 21 collects the
TypeScript gotchas in one place if you would rather look them up than meet them
in context.

---

## 1. The shape of the whole thing

Two directories, one rule:

```
src/core/   domain logic — the filesystem, ids, validation, transitions
src/cli/    commander wiring and output formatting, and nothing else
```

`core` never imports `commander`, never writes to `stdout`, and never calls
`process.exit`. `cli` never touches `fs` to make a decision — it only formats
what `core` hands back and reads the file back for `show`.

The reason is testability, and it is not theoretical: the entire domain layer
is tested without spawning a process, and the CLI layer is tested by spawning
one, so both the pure logic and the real exit codes are covered without either
test style having to fake the other.

Data flows one way:

```
argv ──▶ commander ──▶ cli/<command>.ts ──▶ core/*.ts ──▶ filesystem
                              │
                              └──▶ stdout (results) / stderr (errors, hints)
```

## 2. How a command actually runs

Take `task accept a3f`. End to end:

1. `cli/index.ts` parses argv with commander and calls `statusCommand("accept", "a3f")`.
2. `cli/status.ts` calls `core/lookup.ts` → `resolveRef("a3f")`.
3. `resolveRef` lists filenames in `active/` and `archive/`, matches `a3f` as an
   id prefix, finds one hit, reads that file and validates it.
4. `cli/status.ts` calls `core/transitions.ts` → `nextStatus("accept", task, stem)`,
   which consults the transition table and returns `"todo"` or throws.
5. `core/storage.ts` → `saveTaskFile` writes the file with the new status, then
   renames it if the new status belongs in the other folder.
6. `cli/status.ts` prints `<stem>: proposed → todo` to stdout.

Every failure along that path throws. Nothing returns an error code partway up.
Which brings us to the first module.

## 3. `src/core/errors.ts` — two classes, one catch site

```ts
export class UserError extends Error {
  override readonly name = "UserError";
}

export class DataError extends Error {
  override readonly name = "DataError";
}
```

That is the whole file, and the whole error-handling strategy. The spec defines
three exit codes:

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | User error — bad args, lookup failure, invalid transition, not a repo, no TTY |
| 2 | Data error — a task file fails validation |

So there are exactly two failure classes, and they map one-to-one onto these
two types. Core throws them; `cli/index.ts` catches them in one place and sets
the exit code. No function anywhere returns a `{ ok, error }` pair.

**Why exceptions rather than result types.** A `Result<T, E>` buys you a
compile-time guarantee that callers handle failures — except TypeScript has no
`#[must_use]`, so it does not actually buy you that. What you would get instead
is `Promise<Result<T, E>>` threaded through every core function and unwrapped
at every composition point. `addCommand` alone composes project resolution, id
generation, title derivation, slug generation, and a write, each of which can
fail. With ~25 distinct terminal messages, zero recovery paths (every error
ends the process), and a single handler, exceptions are less code for the same
behaviour.

**Why `override readonly name`.** `Error` already declares `name`, so
redeclaring it needs `override`. Setting it matters because `instanceof` checks
across module boundaries are the actual dispatch mechanism, and a readable
`name` makes a stack trace during development say `UserError` rather than
`Error`.

## 4. `src/core/task.ts` — the data model

```ts
export const STATUSES = [
  "inbox",
  "proposed",
  "todo",
  "in-progress",
  "done",
  "rejected",
] as const;

export type Status = (typeof STATUSES)[number];
```

`Status` is a union derived from a runtime array, not a TypeScript `enum`. That
gives one source of truth for both the type and the runtime list — the list is
needed at runtime to validate a file's `status` field and to print
`must be one of inbox, proposed, ...` in error messages. A TS `enum` would
force a second, hand-maintained copy, and the two would eventually disagree.

`as const` is what makes it work: without it, `STATUSES` is `string[]` and
`(typeof STATUSES)[number]` is just `string`.

The type guard is the bridge back from unvalidated data:

```ts
export function isStatus(value: unknown): value is Status {
  return typeof value === "string" && (STATUSES as readonly string[]).includes(value);
}
```

The `as readonly string[]` cast is needed because `STATUSES.includes(value)`
will not type-check when `value` is `string` — `includes` on a
`readonly ["inbox", ...]` expects one of those literals, which is precisely the
thing we do not yet know.

Then the frontmatter itself:

```ts
export interface Task {
  id: string;
  title: string;
  status: Status;
  project: string;
  created: string;
}
```

**`created` is a `string`, and that is load-bearing.** See section 9 — it is the
single most dangerous trap in this codebase.

`TaskFile` wraps a `Task` with where it lives:

```ts
export interface TaskFile {
  task: Task;
  body: string;
  path: string;
  stem: string;
  folder: "active" | "archive";
}
```

`folder` records where the file *is*, which may disagree with where its
`status` says it *should* be. That disagreement is not a bug — it is the
interrupted-archive state the spec describes, and keeping both facts lets the
code detect and repair it (section 10).

## 5. `src/core/ids.ts` — titles, slugs, and ids

Three pure functions, and the highest bug density in the project.

### Title derivation

The spec says: the first sentence ends at the first newline, or at the first
`.` `!` `?` *followed by whitespace*, whichever comes first, terminator
excluded; then cut to 60 chars at a word boundary.

```ts
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
```

The "followed by whitespace" clause is the whole point. Without it,
`Upgrade to v1.2.3` becomes the title `Upgrade to v1`, and `Node.js` becomes
`Node`. With it, only a `.` that genuinely ends a sentence splits.

> **A deliberate reading, worth knowing about.** A description of
> `"Add retry logic."` has a `.` at the very end with nothing after it, so by
> the literal spec it is not a terminator and the title keeps the period:
> `Add retry logic.`. Treating end-of-string as whitespace instead would give
> `Add retry logic`. Both readings are defensible; this is the one the code
> implements, and `src/core/ids.test.ts` pins it with a named test. Changing it
> is a one-character edit — `next !== undefined &&` becomes
> `(next === undefined || /\s/.test(next))` — plus that test.

The length cut:

```ts
const window = sentence.slice(0, MAX_TITLE_LENGTH);
const lastSpace = window.lastIndexOf(" ");
return lastSpace > 0 ? window.slice(0, lastSpace).trimEnd() : window;
```

`lastSpace > 0` rather than `!== -1` handles the case where the only space is
at index 0, which would otherwise produce an empty title.

### Slugs

```ts
const base = title
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "");
```

Lowercase, collapse every run of non-alphanumerics to one dash, trim the ends.
Then the 40-char cap:

```ts
const window = base.slice(0, MAX_SLUG_LENGTH);
const lastDash = window.lastIndexOf("-");
const cut = lastDash > 0 ? window.slice(0, lastDash) : window;
return cut.replace(/-+$/g, "");
```

**Order matters here.** Truncate to 40 first, *then* cut back to the last dash.
Doing it the other way round — find a dash boundary, then truncate — produces a
different filename. You can check which is right against the spec's own worked
example, and `ids.test.ts` does exactly that:

```
"Fix token refresh failing after laptop sleep"
  → slug 44 chars → truncate to 40 → cut back to the dash at 38
  → "fix-token-refresh-failing-after-laptop"
  → filename "fix-token-refresh-failing-after-laptop-a3f9k2"   ← matches SPECV1.md line 154
```

The fallback covers a title that slugs to nothing — all punctuation, or a
script with no ASCII alphanumerics:

```ts
const SLUG_FALLBACK = "task";
// ...
if (base === "") return SLUG_FALLBACK;
```

Without it the filename would be `-a3f9k2.md`, which looks broken and breaks
nothing loudly. The spec is silent here; `task` is this implementation's
choice.

### Ids

```ts
export function generateId(): string {
  let id = "";
  for (let i = 0; i < ID_LENGTH; i++) {
    id += BASE36[randomInt(BASE36.length)];
  }
  return id;
}
```

`randomInt` comes from `node:crypto`, not `Math.random`. Not for security — for
uniformity. `Math.floor(Math.random() * 36)` is fine in practice, but
`randomInt` is rejection-sampled and free here, so there is no reason to think
about modulo bias at all.

Uniqueness is *not* this function's job. The caller checks against ids already
on disk and regenerates on collision (section 15), because only the caller
knows what is on disk.

## 6. `src/core/body.ts` — sections without a markdown parser

The body has three headings, and Claude rewrites `## Plan` and appends to
`## Log` while leaving `## Description` untouched. That could mean pulling in a
markdown AST library. It does not, for a reason worth stating: gray-matter
round-trips the body byte-for-byte (verified in `frontmatter.test.ts`), so
manipulating it as text preserves the human's formatting exactly. An AST
round-trip would normalise it — reflow lists, change emphasis markers, reindent
code — and the human would find their description quietly rewritten.

So this is a line scanner. The one subtlety:

```ts
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
```

**Fence tracking is not optional.** A plan routinely contains a shell snippet,
and a snippet routinely contains `## something` as a comment. Without the
fence check, that line reads as a new section, and everything after it silently
falls outside the Plan. `body.test.ts` covers this case directly.

Two TypeScript details in that loop:

- `lines[i] ?? ""` — `noUncheckedIndexedAccess` makes `lines[i]` have type
  `string | undefined` even though `i < lines.length`. The compiler does not
  track that relationship, so the `??` is how you discharge it.
- `match?.[1] !== undefined` rather than `if (match)` — a capture group is
  `string | undefined` under the same setting, and checking the group directly
  narrows it for the `push` on the same line.

Section boundaries come from the heading list:

```ts
return headings.map((heading, index) => ({
  name: heading.name,
  headingLine: heading.line,
  contentStart: heading.line + 1,
  contentEnd: headings[index + 1]?.line ?? lines.length,
}));
```

A section runs to the next `## ` heading or to end of body. `###` subheadings
inside a Plan are content, not boundaries, which is what you want.

`setSection` rebuilds the body around the replaced range:

```ts
const replacement = trimmed === "" ? [""] : ["", ...trimmed.split("\n"), ""];

return [
  ...lines.slice(0, section.contentStart),
  ...replacement,
  ...lines.slice(section.contentEnd),
].join("\n");
```

The leading and trailing `""` entries produce one blank line after the heading
and one before whatever comes next — or, when the section is the last one, the
file's terminating newline. That detail is easy to get wrong in the direction
of "file no longer ends in a newline", and there is a test for exactly that.

`appendLog` is `getSection` + `setSection`, which is why `## Log` stays
append-only without any special-case code:

```ts
export function appendLog(body: string, text: string, now: Date = new Date()): string {
  const entry = `- ${toIsoUtc(now)} — ${text}`;
  const existing = getSection(body, "Log");
  return setSection(body, "Log", existing === "" ? entry : `${existing}\n${entry}`);
}
```

The injectable `now` parameter is there purely so tests can assert an exact
timestamp instead of matching a regex.

```ts
export function toIsoUtc(date: Date = new Date()): string {
  return `${date.toISOString().slice(0, 19)}Z`;
}
```

`toISOString()` emits milliseconds (`...T14:02:00.123Z`); the spec's example
does not. Truncating to 19 characters and re-appending `Z` gives second
precision. This matters more than it looks — see the next two sections.

## 7. `src/core/validate.ts` — the exit-2 boundary

Every command validates every file it reads. This module is where a
`Record<string, unknown>` from a YAML parser becomes a `Task`, or throws.

```ts
function fail(filename: string, field: string, problem: string): never {
  throw new DataError(`${filename}: ${field} ${problem}`);
}
```

The `never` return type is what lets `fail(...)` be used as a statement in the
middle of a function without the compiler complaining that a later `return`
might be unreachable — or, more usefully, without it thinking a variable might
still be `undefined` after the check.

The message shape is the spec's: `<filename>: <field> <problem>`. The `Error: `
prefix is added exactly once, in `cli/index.ts`, so it cannot be doubled up or
forgotten.

Unknown fields are rejected before anything else:

```ts
const known = new Set<string>(TASK_FIELDS);
for (const key of Object.keys(data)) {
  if (!known.has(key)) fail(filename, key, "is not a known field");
}
```

This is the spec being deliberately strict. A typo'd or invented frontmatter
key is a mistake, and failing loudly beats silently dropping it on the next
write.

`requireString` carries the interesting check:

```ts
if (value instanceof Date) {
  fail(filename, field, "must be a quoted string, not a bare YAML timestamp");
}
```

Which needs its own section.

## 8. The `created` trap

This is the one that will bite anyone who changes this code, so it gets spelled
out.

YAML has a native timestamp type. Given this frontmatter:

```yaml
created: 2026-09-15T14:02:00Z
```

gray-matter's YAML parser does not give you the string `"2026-09-15T14:02:00Z"`.
It gives you a JavaScript `Date`. And when you write that `Date` back out, it
serialises as:

```yaml
created: 2026-09-15T14:02:00.000Z
```

Milliseconds appear from nowhere. Read it again, write it again, and the file
has quietly changed twice for no reason — on every single command that touches
it.

The fix is two-sided.

**On write**, `created` is always a `string` in the `Task` type, and a string
value makes the YAML dumper quote it:

```yaml
created: '2026-09-15T14:02:00Z'
```

A quoted scalar reads back as a string, so the round-trip is now stable. There
is a test asserting that serialising twice produces byte-identical output.

**On read**, a `Date` can still arrive — from a file a human edited by hand and
left unquoted. Rather than silently coercing it (which would rewrite their
file), validation rejects it and names the field. The user sees the problem
instead of inheriting it.

The same YAML-types hazard applies to other fields, which is why validation
checks `typeof value === "string"` before anything else. A six-character base36
id can legitimately come out as `123456`, which YAML reads as a *number*; the
dumper quotes it on write, and the validator gives a clear message rather than
crashing on `.trim()` of a number if it ever sees one.

## 9. `src/core/frontmatter.ts` — parse and serialize

Small file, two traps.

### Trap one: the cache

```ts
// The options argument is not optional in practice: calling `matter(raw)`
// hits a module-level cache that returns a shallow copy sharing the same
// `.data` object, so a mutation anywhere would poison every later parse of
// identical content. Passing `{}` bypasses the cache entirely.
parsed = matter(raw, {});
```

gray-matter memoises by file content. Two `matter(raw)` calls with identical
input return two different wrapper objects **whose `.data` is the same object
reference**. Mutate `parsed.data.status` in one place and every later parse of
identical content sees the mutation. This is easy to verify:

```js
const a = matter(src), b = matter(src);
a.data === b.data;        // true
a.data.status = "X";
b.data.status;            // "X"
```

This code never mutates `parsed.data` — validation builds a fresh object — so
the bug is latent rather than live. Passing `{}` removes the landmine anyway,
because the next person to reach for `parsed.data` should not have to know
this.

### Trap two: writing YAML by hand

Titles are derived from arbitrary capture text. `Fix bug: token refresh` is an
entirely ordinary title. Written naively:

```yaml
title: Fix bug: token refresh
```

That is not valid YAML, and the file can never be read again. `#` truncates the
value at the comment marker; a leading `-` throws. So serialization always goes
through the dumper, never through string concatenation:

```ts
export function serializeTaskFile(task: Task, body: string): string {
  // Rebuild the object field-by-field so key order always matches the spec.
  const data: Record<string, string> = {};
  for (const field of TASK_FIELDS) data[field] = task[field];
  return matter.stringify(body, data);
}
```

Rebuilding the object from `TASK_FIELDS` rather than passing `task` directly
guarantees the key order in the file is always `id, title, status, project,
created`, regardless of what order the keys happened to be in memory. Files
stay diff-stable.

Malformed YAML is caught and reclassified:

```ts
} catch (error) {
  const reason = error instanceof Error ? error.message.split("\n")[0] : String(error);
  throw new DataError(`${filename}: frontmatter is not valid YAML (${reason})`);
}
```

Without this, a hand-broken file produces a raw `YAMLException` stack trace and
Node's own exit code — wrong on both counts. The parser's message is multi-line
and includes a source excerpt, so only the first line is kept.

## 10. `src/core/storage.ts` — the filesystem, and the archive rule

Root resolution is the whole `TASKS_DIR` story:

```ts
export function tasksRoot(): string {
  const override = process.env["TASKS_DIR"];
  if (override !== undefined && override.trim() !== "") return path.resolve(override);
  return path.join(homedir(), "tasks");
}
```

`path.resolve` means a relative `TASKS_DIR` works. Note there is no `~`
expansion — that is the shell's job, and `TASKS_DIR='~/tasks'` in quotes would
create a literal `./~` directory. Worth knowing.

`process.env["TASKS_DIR"]` uses bracket notation because `@types/node` declares
`ProcessEnv` with an index signature, and dot access on an index signature is
the kind of thing `noPropertyAccessFromIndexSignature` flags. It is commented
out in `tsconfig.json` today, but bracket notation is the honest spelling: the
key may not be there, and the type reflects that.

### The archiving rule

This is the most carefully ordered code in the project:

```ts
export async function saveTaskFile(file: TaskFile): Promise<TaskFile> {
  await writeTaskFile(file);
  return relocate(file);
}
```

Write the status **first**, then rename. The spec mandates this order and the
reason is crash safety. A rename within one filesystem is atomic, so an
interruption can land in exactly one of two states:

- **Before the rename** — a file correctly labelled `done` still sitting in
  `active/`. Recoverable: the status is the truth, and the location is stale.
- **After the rename** — everything is consistent.

Do it the other way round and an interruption leaves a file in `archive/` still
labelled `in-progress`, where status and location disagree with no way to tell
which one to believe.

Recovery falls out of deriving the target from the *status*, never from the
command:

```ts
export async function relocate(file: TaskFile): Promise<TaskFile> {
  const target = folderForStatus(file.task);
  if (target === file.folder) return file;

  const newPath = path.join(folderPath(target), `${file.stem}.md`);
  await mkdir(folderPath(target), { recursive: true });
  await rename(file.path, newPath);
  return { ...file, path: newPath, folder: target };
}
```

Because the target comes from the status, *every* command that saves a file
repairs a stale location for free — which is exactly the spec's "the next
archiving command moves it", with no special-case code and no repair routine.

### Listing

```ts
const names = entries.filter((name) => name.endsWith(".md")).sort();

const files: TaskFile[] = [];
for (const name of names) {
  files.push(await readOne(folder, name));
}
```

The `.sort()` before reading looks cosmetic and is not. The spec says `ls`
stops at the *first* invalid file — and "first" only means anything if the read
order is deterministic. `readdir` order is filesystem-dependent, so without the
sort the same broken directory could report different files on different runs.

The `for` loop is deliberate too: `Promise.all` would read every file
concurrently and reject with whichever failure happened to land first, which is
the same non-determinism by a different route. Sequential reads make "first
invalid file" mean what it says.

Sorting is oldest-first with a tie-break:

```ts
function byCreated(a: TaskFile, b: TaskFile): number {
  return a.task.created.localeCompare(b.task.created) || a.stem.localeCompare(b.stem);
}
```

Two tasks captured in the same second are not rare — capture is meant to be
fast. Without the `|| a.stem.localeCompare(b.stem)`, their relative order is
whatever the sort happens to do.

## 11. `src/core/lookup.ts` — resolving a `<ref>`

Precedence is stem, then exact id, then unique prefix:

```ts
const byStem = all.filter((c) => c.stem === ref);
const byId = all.filter((c) => c.id === ref);
const byPrefix =
  ref.length >= MIN_PREFIX_LENGTH ? all.filter((c) => c.id.startsWith(ref)) : [];

const matches = byStem.length > 0 ? byStem : byId.length > 0 ? byId : byPrefix;
```

Evaluating the tiers separately and picking the first non-empty one is what
makes precedence work. Collecting all matches into one list and counting them
would report an exact id as "ambiguous" whenever some other id happened to
start with the same characters.

The three-character minimum applies **only to the prefix tier**. A two-character
ref simply matches nothing and gets `no task matches "ab"` — not a special
"too short" error. That falls out of `byPrefix` being `[]` rather than needing
a branch.

**Lookup reads no files while matching.** It works entirely from filenames:

```ts
const stem = name.slice(0, -".md".length);
const dash = stem.lastIndexOf("-");
found.push({ stem, id: dash === -1 ? stem : stem.slice(dash + 1), folder });
```

Two consequences, both good. `task show a3f` cannot fail with exit 2 because
some *unrelated* file in the directory is malformed — only the file you
actually asked for gets parsed. And resolution costs one `readdir` per folder
instead of one read per task.

Ref normalisation accepts what a shell actually produces:

```ts
export function normalizeRef(ref: string): string {
  const base = path.basename(ref.trim());
  return (base.endsWith(".md") ? base.slice(0, -".md".length) : base).toLowerCase();
}
```

Tab-completing a task gives you `fix-thing-a3f9k2.md` or
`active/fix-thing-a3f9k2.md`. Both should work. Ids and slugs are always
lowercase, so lowercasing the input can only help.

The ambiguous case builds a multi-line message:

```ts
const stems = matches.map((c) => c.stem).join("\n");
throw new UserError(`"${ref}" matches multiple tasks:\n${stems}`);
```

Since `cli/index.ts` prints `Error: ${message}`, the prefix lands on the first
line only and the stems below are bare — which is the format the spec asks for.

## 12. `src/core/project.ts` — inferring the project from git

```ts
function git(args: string[]): string | undefined {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return undefined;
  }
}
```

`stdio: ["ignore", "pipe", "ignore"]` silences git's stderr. Outside a repo,
`git rev-parse` prints `fatal: not a git repository` — we handle that case
ourselves with a better message, and git's version leaking through would be
noise. `execFileSync` (not `execSync`) means no shell, so no quoting concerns.

Resolution order is the spec's:

```ts
if (flag !== undefined && flag.trim() !== "") return flag.trim();

if (inGitRepo()) {
  const remote = git(["remote", "get-url", "origin"]);
  if (remote !== undefined) {
    const name = repoNameFromUrl(remote);
    if (name !== undefined) return name;
  }
  const toplevel = git(["rev-parse", "--show-toplevel"]);
  if (toplevel !== undefined && toplevel !== "") return path.basename(toplevel);
}

throw new UserError("not in a git repository. Run inside a repo or pass --project <name>.");
```

The remote comes before the directory name because it is stable across clones
and worktrees, which routinely sit in differently-named directories. URL
parsing handles both forms with one split:

```ts
const segment = cleaned.split(/[/:]/).pop();
```

Splitting on both `/` and `:` covers `git@github.com:owner/repo.git` and
`https://github.com/owner/repo.git` without two code paths.

`currentProject()` is the non-throwing variant, and it exists for exactly one
caller: `ls` outside a repo, which must list everything rather than fail
(section 16).

**Note:** git only ever runs in the current working directory. The tool never
runs git against the data directory — that is an explicit spec requirement.

## 13. `src/core/transitions.ts` — the table

The spec's transition table, transcribed:

```ts
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
```

Data, not control flow. `restore` is the only command whose destination depends
on where it started, and as a table that needs no special case at all.

```ts
const rule = TABLE[command].find((r) => r.from === task.status);
if (rule === undefined) {
  const expected = allowedFrom(command).join(", ");
  throw new UserError(
    `cannot ${command} ${stem}: status is ${task.status} (expected ${expected})`,
  );
}
return rule.to;
```

The `undefined` check is both the error branch and the narrowing that makes
`rule.to` legal on the last line — `find` returns `T | undefined`, so there is
no way to reach the return without having handled the failure.

`transitions.test.ts` asserts the full 6 commands × 6 statuses matrix: the eight
legal pairs succeed, and all twenty-eight others throw. That is cheap to write
against a table and catches a transcription error immediately.

---

## 14. `src/cli/format.ts` — presentation, and nothing else

Nothing in this file touches the filesystem or decides policy. That is the
`core`/`cli` boundary being enforced by where code lives.

```ts
const minutes = Math.max(0, Math.floor((now.getTime() - then) / 60_000));
if (minutes < 60) return `${minutes}m`;
const hours = Math.floor(minutes / 60);
if (hours < 24) return `${hours}h`;
return `${Math.floor(hours / 24)}d`;
```

The spec gives `3d` and `5h` as examples and leaves the rest open. This fills
in: minutes below an hour, hours below a day, days above. `Math.max(0, ...)`
handles a `created` timestamp in the future — clock skew, or a hand-edited file
— rendering `0m` instead of `-3m`.

`now` is a parameter with a default rather than a call to `new Date()` inside,
so age formatting is testable at exact boundaries: 59m, 60m, 23h59m, 24h.

Table rendering pads to the widest cell per column:

```ts
const widths = COLUMNS.map((heading, index) =>
  rows.reduce((max, row) => Math.max(max, (row[index] ?? "").length), heading.length),
);
```

Seeding the reduce with `heading.length` means the header itself is never
truncated by a column of short values. The `?? ""` is `noUncheckedIndexedAccess`
again.

```ts
.map((cell, index) => (index === cells.length - 1 ? cell : cell.padEnd(widths[index] ?? 0)))
```

The last column is not padded, so no line carries trailing whitespace — which
matters because a test asserts it, and because trailing spaces are noise in a
terminal and in a diff.

## 15. `src/cli/add.ts` — capture

```ts
const text = description.trim();
if (text === "") throw new UserError("task description required");

// Resolve the project before writing anything, so a failure here creates no file.
const project = resolveProject(options.project);
```

Ordering is deliberate. Project resolution can fail, and failing *before* any
filesystem work means a failed `add` leaves nothing behind — not a file, not
even the `active/` directory. There is a test for this.

Then the collision loop the spec calls for:

```ts
const taken = await existingIds();
let id = generateId();
while (taken.has(id)) id = generateId();
```

`existingIds` reads both folders, because an id must be unique across active
*and* archived tasks — otherwise restoring an archived task could collide with
something created since.

The body template is fixed at creation:

```ts
function initialBody(description: string): string {
  return `## Description\n${description}\n\n## Plan\n\n## Log\n`;
}
```

All three headings exist from the start with empty content, which is what makes
`## Plan` safe for Claude to rewrite without ever needing to create a section.

## 16. `src/cli/ls.ts` — the two subtle bits

```ts
files = files.filter((file) => folderForStatus(file.task) === folder);
```

One line, and it is the interrupted-archive rule. A `done` file still sitting in
`active/` is hidden from `ls`. Writing it as
`folderForStatus(task) === folder` rather than `!isArchivedStatus(status)`
covers the mirror case too — a stray `todo` file in `archive/` is hidden from
`ls --archived` by the same test.

```ts
// Outside a git repo there is no project to scope to, so listing everything
// is the useful behaviour — listing, unlike capture, needs no project.
const project = options.all === true ? undefined : currentProject();
```

`currentProject()` is the non-throwing variant. Outside a repo it returns
`undefined`, the project filter never applies, and `ls` behaves as `--all` with
no error and — importantly — **no footer**, because a footer about "other
projects" is meaningless when nothing was filtered. This is easy to get wrong
by defaulting `project` to `""`, which would filter out every task and print
`No tasks.` in a directory full of them.

The output split follows the spec exactly:

```ts
if (shown.length === 0) {
  console.error("No tasks.");
  return;
}

console.log(formatTable(shown));

if (project !== undefined) {
  console.error(formatFooter(shown.length, project, files.length - shown.length));
}
```

The table goes to **stdout**; `No tasks.` and the footer go to **stderr**. That
is what makes `task ls > file` produce a clean table with no chatter, and it is
why `--json` returns early before either stderr write — a machine consumer gets
`[]` on stdout and silence on stderr.

## 17. `src/cli/status.ts` — all six commands, one path

```ts
const from = file.task.status;

// Status is checked first: proposing a `todo` task is a wrong-status error,
// not a complaint about its Plan.
const to = nextStatus(command, file.task, file.stem);

// The one command with an extra precondition beyond the transition table.
if (command === "propose" && isSectionEmpty(file.body, "Plan")) {
  throw new UserError(`cannot propose ${file.stem}: Plan section is empty`);
}
```

**Check order is a real decision.** `propose` has two ways to fail: wrong
status, and an empty Plan. Running the Plan check first means proposing an
already-accepted `todo` task complains about its Plan — confusing, because the
Plan is not the problem. Status first gives the more useful message.

`applyTransition` returns both the updated file and the output line rather than
printing, so `review` can reuse it:

```ts
export async function applyTransition(
  command: TransitionCommand,
  ref: string,
): Promise<{ file: TaskFile; line: string }> {
```

That is what makes the spec's "actions call the same code paths as the
standalone commands" literally true rather than aspirational — `review` cannot
drift out of sync with `accept`, because it *is* `accept`.

## 18. `src/cli/edit.ts` — the rollback

```ts
const file = await resolveRef(ref);
const original = await readFile(file.path, "utf8");
```

`resolveRef` validates the file **before** the editor launches. A file that is
already broken is an exit-2 data error; there is no point opening an editor on
it and then blaming the user for what it finds.

Capturing `original` as raw bytes — not a re-serialization of the parsed task —
is what makes rollback honest. Re-serializing would normalise quoting and
whitespace, so "restored unchanged" would be a lie.

```ts
const edited = await readFile(file.path, "utf8");
if (edited === original) return;
```

Re-reading **by path** matters: `vim` with default settings writes a new file
and renames it over the old one, so a file descriptor held across the editor
call would point at a deleted inode.

The rollback itself:

```ts
const restore = async (reason: string): Promise<never> => {
  await writeFile(file.path, original, "utf8");
  throw new UserError(`${reason}. ${file.stem} was restored unchanged`);
};
```

`Promise<never>` lets `return restore(...)` be used in a function that
otherwise returns `Promise<void>`, and signals that it always throws.

Note it throws `UserError` (exit 1), not `DataError` (exit 2), even when the
failure is a validation error. That is a deliberate reading of the spec:
section 4 says `edit` exits 1 when the post-edit content is invalid, while
section 5 says an invalid *file* is exit 2. Content the user just typed in this
command is a user error; a file that was already broken before the command ran
is a data error. Both readings appear in the spec, and this is the split the
code implements.

Immutability covers all five fields:

```ts
function changedImmutableField(before: Task, after: Task): string | undefined {
  return TASK_FIELDS.find((field) => before[field] !== after[field]);
}
```

Including `status` — the spec's field table says status is mutable "via
commands only", and `edit` is not a command in that sense. Driving the check
from `TASK_FIELDS` means adding a field to the model automatically protects it.

## 19. `src/cli/review.ts` and `src/cli/index.ts`

### The EOF problem

`readline`'s `question()` returns a promise that never settles if the stream
closes first. Press Ctrl-D at a prompt and the process hangs forever. So the
question races the close event:

```ts
const ask = async (question: string): Promise<string | null> => {
  if (closed) return null;
  return new Promise<string | null>((resolve) => {
    let settled = false;
    const finish = (value: string | null): void => {
      if (settled) return;
      settled = true;
      rl.off("close", onClose);
      resolve(value);
    };
    const onClose = (): void => finish(null);
    rl.once("close", onClose);
    rl.question(question).then(finish, () => finish(null));
  });
};
```

`null` means EOF, which is treated like `q`. The `settled` flag makes `finish`
idempotent, since both the answer and the close event can fire.

`rl.close()` lives in a `finally` — without it the process keeps the stdin
handle open and never exits.

Each action re-resolves the task by stem rather than using the snapshot taken at
the start, because an earlier `reject` in the same session may have moved a
file into `archive/` and a stale path would `ENOENT`.

### The one exit point

```ts
async function main(): Promise<void> {
  try {
    await buildProgram().parseAsync(process.argv);
  } catch (error) {
    if (error instanceof UserError) {
      console.error(`Error: ${error.message}`);
      process.exitCode = 1;
      return;
    }
    if (error instanceof DataError) {
      console.error(`Error: ${error.message}`);
      process.exitCode = 2;
      return;
    }
    throw error;
  }
}
```

Three things here are deliberate:

- **`parseAsync`, not `parse`.** Commander only awaits action handlers in the
  async variant. With `parse()`, a rejection from an async action becomes an
  unhandled promise rejection and the exit code is wrong.
- **`process.exitCode`, not `process.exit()`.** `process.exit()` terminates
  immediately and can truncate buffered stdout when output is piped — a long
  `task ls | head` is exactly the case that loses data. Setting `exitCode` lets
  Node flush and exit naturally.
- **Unknown errors are re-thrown.** A genuine bug should produce a stack trace,
  not get flattened into a tidy exit code that hides it.

The six status commands are registered from the same table that defines them:

```ts
for (const command of TRANSITION_COMMANDS) {
  program
    .command(command)
    .argument("<ref>", "filename stem, exact id, or unique id prefix")
    .description(TRANSITION_HELP[command])
    .action((ref: string) => statusCommand(command, ref));
}
```

Adding a transition means adding a row to `TABLE` and a line to
`TRANSITION_HELP`; the command surface follows automatically.

---

## 20. The tests

139 tests across nine files, in two styles.

**Unit tests** (`src/core/*.test.ts`, `src/cli/format.test.ts`) import functions
directly. They cover the pure logic: title and slug rules against the spec's own
worked example, the full transition matrix, every validation message, section
handling including the fenced-code case, age boundaries.

**Integration tests** (`src/cli/cli.test.ts`) spawn the real CLI as a child
process via `tsx` and assert on **stdout, stderr, and exit code** separately.
That is the only way to verify the things the spec is specific about: that the
footer is on stderr, that `--json` prints `[]` and nothing else, that an invalid
file produces exit 2 with *no* partial stdout.

### Filesystem isolation

Two layers, because one is not enough.

The primary layer is an explicit `TASKS_DIR` per test, created with `mkdtemp`
and removed in `afterEach`:

```ts
beforeEach(async () => {
  dir = await makeTasksDir();
  process.env["TASKS_DIR"] = dir;
});
```

The second layer is `src/test/setup.ts`, which runs before every test file:

```ts
const sandbox = await mkdtemp(path.join(tmpdir(), "task-cli-home-"));
delete process.env["TASKS_DIR"];
process.env["HOME"] = sandbox;
process.env["USERPROFILE"] = sandbox;
```

This is the belt to the first layer's braces. If any code path ever falls back
to the default `~/tasks`, `homedir()` resolves inside a throwaway directory — so
a test cannot touch real task data even if someone forgets the first layer.
That is worth the six lines: the failure mode it prevents is "the test suite
deleted my tasks".

### Build configuration

Tests live in `src/` so `pnpm typecheck` covers them. They must not ship in
`dist/`, so `tsconfig.build.json` excludes them and `build` uses it:

```json
{ "extends": "./tsconfig.json", "exclude": ["src/**/*.test.ts", "src/test/**"] }
```

## 21. The TypeScript settings, collected

These four settings shape more of this code than any style preference. If
something looks over-careful, it is probably one of these.

**`noUncheckedIndexedAccess`** — every indexed access is `T | undefined`, even
when a bounds check sits right above it. The compiler does not track the
relationship between `i < lines.length` and `lines[i]`. Shows up as `?? ""` in
`body.ts` and `format.ts`, and as `match?.[1] !== undefined` where a regex
capture group is used.

**`exactOptionalPropertyTypes`** — you cannot assign `undefined` to an optional
property; you have to omit the key. This is why `TaskFile` has no optional
fields and why option interfaces are only ever *read*, never built by assigning
`undefined`.

**`verbatimModuleSyntax`** — a type-only import must be marked as one, so the
compiler can erase it without having to work out whether it was a value. Either
spelling works. A whole-module type import:

```ts
import type { Task } from "./task.js";
```

or, when you need values and types from the same module, an inline `type`
modifier on just the type — which is what most of `core` does:

```ts
import { STATUSES, TASK_FIELDS, isStatus, type Task } from "./task.js";
```

Dropping the `type` on `Task` there is an error, not an inference the compiler
will make for you.

**`module: nodenext`** — relative imports need explicit `.js` extensions, even
in `.ts` source: `./task.js`, never `./task`. The extension refers to the
compiled output. Every relative import in this codebase carries it.

## 22. Where to extend

The spec's section 8 lists the open questions. Mapping them to code:

| Change | Where |
|---|---|
| `ls` skips invalid files with a warning instead of failing | `core/storage.ts` — `listTaskFiles`, catch per file |
| A new status | `core/task.ts` `STATUSES`, then `core/transitions.ts` `TABLE` |
| A new command | `cli/<name>.ts` + one registration in `cli/index.ts` |
| A new frontmatter field | `core/task.ts` `Task` + `TASK_FIELDS`, then `core/validate.ts` |
| `task next` | `cli/` only, on top of `listTaskFiles` |
| Title substring lookup | `core/lookup.ts` — a fourth tier after prefix |
| Auto-commit the data directory | `core/storage.ts` — but note the spec's rule that the tool never runs git against the data directory |

The boundary to preserve is the one in section 1: if a change needs the
filesystem, ids, validation, or status rules, it belongs in `core`. If it only
decides how something is printed, it belongs in `cli`.
