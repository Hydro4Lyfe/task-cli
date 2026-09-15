# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

**Implemented and green** — every command in the spec exists, `pnpm typecheck` is
clean, and `pnpm test` passes 139 tests across 9 files. Nothing is committed yet:
all of `src/`, `docs/` and `skill/` is still untracked on `main`.

Two documents matter before you change anything:

- `docs/SPECV1.md` is authoritative. It settles the data model, command surface,
  error messages and exit codes; section 7 records the rationale for each
  decision and section 8 lists what is deliberately unresolved.
- `docs/CODE_WALKTHROUGH.md` walks the implementation module by module and
  explains the traps behind the non-obvious code. Read it before editing `core`.

task-cli captures coding tasks from the terminal as markdown files that both the
human and Claude read and edit. The workflow is a joint loop: Claude proposes a
plan, the human approves, Claude implements, the human confirms completion.

## Commands

pnpm only (`packageManager: pnpm@12.4.2`; CI installs with `--frozen-lockfile`).

```bash
pnpm test                      # vitest run
pnpm test:watch
pnpm vitest run <path>         # single file
pnpm vitest run -t "<name>"    # single test by name
pnpm typecheck                 # tsc --noEmit, covers tests too
pnpm build                     # tsc -p tsconfig.build.json -> dist/
pnpm dev ls --json             # run the CLI from source via tsx, no build
```

`tsconfig.build.json` exists only to keep `src/**/*.test.ts` and `src/test/` out
of `dist/`; `pnpm typecheck` uses the wider `tsconfig.json` and still checks them.

`.github/workflows/ci.yml` runs **only `pnpm test`** — no typecheck, no build.
Run `pnpm typecheck` locally before pushing or type errors reach `main` unnoticed.

No linter or formatter is configured. Don't add one without asking.

A build into a **fresh** `dist/` writes `dist/cli/index.js` as `0644` despite its
shebang, which breaks any `bin` symlink pointing at it; rebuilding over an
existing `dist/` preserves whatever mode the file already had. So the breakage
only appears after `rm -rf dist` — `chmod +x dist/cli/index.js` to restore it.

## Toolchain constraints

These bite when writing code and are not obvious from the source:

- **ESM + `module: nodenext`** — relative imports need explicit `.js` extensions (`./task.js`, not `./task`).
- **`verbatimModuleSyntax`** — type-only imports must be written `import type { Task } from "./task.js"`.
- **`noUncheckedIndexedAccess`** — any indexed access yields `T | undefined`; narrow before use. This is why the code is full of `?? ""` and `=== undefined` guards that otherwise look paranoid.
- **`exactOptionalPropertyTypes`** — you cannot assign `undefined` to an optional property; omit the key instead.
- Node 24 (matches CI), TypeScript 7, vitest 5.
- Dependencies are deliberately minimal: `commander` for command wiring, `gray-matter` for YAML frontmatter. Alert before adding others.

## Architecture

The `src/core` / `src/cli` split is the load-bearing boundary and dependencies
only ever point one way: `cli` imports `core`, never the reverse, and nothing in
`core` writes to stdout.

**`src/core`** — domain logic:

| Module | Responsibility |
|---|---|
| `task.ts` | The `Task`/`TaskFile` types, the status list, which statuses are archived |
| `errors.ts` | `UserError` (exit 1) and `DataError` (exit 2) — the only two error classes |
| `ids.ts` | Title derivation, slugs, random ids, the `<slug>-<id>` stem |
| `body.ts` | Locating and rewriting the three `##` sections; log entries; ISO timestamps |
| `validate.ts` | The exit-2 boundary: frontmatter and body checks on files read from disk |
| `frontmatter.ts` | gray-matter parse/serialize, wrapped in validation |
| `storage.ts` | Paths, listing, reading, writing, and the write-then-rename archive rule |
| `lookup.ts` | Resolving a `<ref>` to exactly one file |
| `project.ts` | Inferring the project name from git |
| `transitions.ts` | The status transition table and the invalid-transition error |

**`src/cli`** — commander wiring and output formatting only. `format.ts` touches
neither the filesystem nor policy. `index.ts` is the single exit point: it
catches `UserError` and `DataError`, maps them to exit codes 1 and 2, and
**re-throws anything else with its stack intact** rather than flattening a real
bug into an exit code. Nothing else in the codebase calls `process.exit`.

Every command must also work non-interactively, because Claude runs in a non-TTY
shell — `edit` and `review` are the only TTY-required commands, and both check
`isTTY` and throw `UserError` rather than hanging.

The six status commands are registered from the same `TRANSITION_COMMANDS` table
that defines the transitions, and `review` delegates to the same
`applyTransition` the standalone commands use — so the two paths cannot drift.

**Storage.** Root `~/tasks/`, overridable via `TASKS_DIR`, with `active/` and
`archive/` created on demand. The tool never runs git against the data directory.

**Identity.** `id` is 6-char lowercase base36, random, unique across both
folders. Filename is `<slug>-<id>.md`, fixed at creation and never renamed. A
`<ref>` resolves in order: full filename stem → exact id → unique id prefix (min
3 chars), searching both folders; no match or an ambiguous match exits 1.
Lookup matches on **filenames only** and parses just the file it resolves to, so
one malformed task cannot break an unrelated lookup. `normalizeRef` strips a
directory prefix and a trailing `.md` so shell tab-completion works.

**File format.** Frontmatter `id, title, status, project, created` — unknown
fields are a validation error. Body has three required headings: `## Description`
(human-owned, Claude does not edit), `## Plan` (Claude writes, rewritten in place
on each revision), `## Log` (append-only `- <ISO 8601 UTC> — <text>`).

**Status and archiving.** Statuses are `inbox, proposed, todo, in-progress, done,
rejected`. `done` and `rejected` live in `archive/`, everything else in
`active/`. Archive by writing status in place, then renaming — atomic on the same
filesystem, so an interruption can only leave a correctly-labelled file in the
wrong folder. A `done`/`rejected` file still sitting in `active/` is exactly that
interrupted archive: `ls` hides it and the next archiving command moves it.

Actor rules (human owns `accept`/`reject`/`done`/`restore`; Claude owns
`propose`/`start`/`add --proposed`) are enforced by convention through
`skill/SKILL.md`, not by code.

**Conventions.** stdout carries output, stderr carries errors and hints — `ls`
prints its table to stdout and its project footer to stderr, so piping stays
clean. Exit 0 success, 1 user error (bad args, lookup failure, invalid
transition, not a repo, no TTY), 2 data error (a file fails validation). Every
command validates every file it reads; `ls` stops on the first invalid file — v1
favors loud failure over partial output. No locking; last write wins.

## Traps

Each of these has a comment at the site and a fuller explanation in the walkthrough:

- **`created` is a `string`, never a `Date`.** YAML coerces an unquoted ISO timestamp into a `Date` that re-serializes with milliseconds, silently rewriting the field on every read/write cycle. `validate.ts` rejects a bare `Date` outright, and `serializeTaskFile` goes through `matter.stringify` so the value is written quoted.
- **`matter(raw, {})`, never `matter(raw)`.** The one-argument form hits a module-level cache that hands back copies sharing one `.data` object. Passing `{}` bypasses it.
- **Never build frontmatter by string concatenation.** Titles come from arbitrary capture text, so a title containing `: ` is routine and would produce an unparseable file.
- **Section parsing skips fenced code blocks**, so a plan containing a shell snippet with `## ` in it is not mistaken for a new heading.
- **Write status first, then rename.** `saveTaskFile` depends on this order; reversing it can leave a file whose status and location disagree with no way to tell which is right.
- **`edit` restores the original bytes** on any validation failure or immutable-field change, so a task file is never left in a state the tool cannot read.

## Testing

`src/test/setup.ts` runs before every suite and repoints `HOME` at a throwaway
directory, so even a code path that falls back to the default `~/tasks` cannot
touch real data. Individual tests get an isolated root via `makeTasksDir()`.

`src/cli/cli.test.ts` spawns the real CLI through `tsx` as a child process to
exercise exit codes and the stdout/stderr split end to end. That is most of the
suite's ~14s runtime — use `pnpm vitest run src/core/<file>.test.ts` for a tight
loop on core changes.

## Repo notes

- Primary platform is Ubuntu on WSL2. Task data must live on the Linux filesystem, never under `/mnt/c`, for filesystem performance.
- `skill/SKILL.md` exists and is specified in section 6 of the spec, but is not yet symlinked to `~/.claude/skills/task-cli/` — until it is, the actor rules it encodes are unenforced.
