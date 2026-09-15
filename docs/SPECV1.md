# task-cli Specification (v1)

## 1. Purpose
I lose track of coding tasks I want Claude to complete. task-cli captures
them quickly from the terminal and stores them as markdown that both I and
Claude can read, refine, and act on. Planning is a joint effort: Claude
proposes an implementation plan, I approve it, Claude implements, I confirm
completion.

**v1 is done when:** I have used it for real work every day for 7 days.

## 2. Scope

### In scope (v1)
- Capture a task in one command, project inferred from git
- List active tasks (current project by default, `--all`, `--archived`, `--json`)
- Show a single task in full
- Status transitions: propose, accept, reject, start, done, restore
- Edit a task body in `$EDITOR`
- Interactive review as a wrapper over non-interactive commands
- Schema validation on every read
- A Claude Code skill describing how to work with tasks

### Out of scope (v1)
- Priority, tags, due dates
- Renaming tasks (titles and filenames are immutable)
- LLM-generated titles
- MCP server (Phase 3)
- Web UI, sync, automatic git commits
- Automatic deletion of archived tasks
- `task next`
- Substring/title lookup

## 3. Data model

### Environment
- Primary platform: Ubuntu on WSL2.
- Data MUST live on the Linux filesystem (e.g. `/home/<user>`), not under
  `/mnt/c`, for filesystem performance.

### Storage
- Root: `~/tasks/` (override with `TASKS_DIR`)
- Active tasks: `<root>/active/`
- Archived tasks: `<root>/archive/`
- Root and subfolders are created automatically if missing.
- The tool never runs git commands against the data directory.

### Identifiers
- `id`: 6-char lowercase base36, random, unique across `active/` and `archive/`.
  On collision, regenerate.
- Slug: from title at creation. Lowercase; runs of non-alphanumerics → `-`;
  trim leading/trailing `-`; max 40 chars, cut at a `-` boundary where possible.
- Filename: `<slug>-<id>.md`, fixed at creation, never renamed.
- **Lookup** (`<ref>` in commands) matches, in order:
  1. Full filename stem (`fix-token-refresh-a3f9k2`)
  2. Exact id (`a3f9k2`)
  3. Unique id prefix (`a3f`), minimum 3 chars
- Lookup searches `active/` and `archive/`.
- No match → exit 1: `Error: no task matches "<ref>"`
- Multiple matches → exit 1: `Error: "<ref>" matches multiple tasks:` followed
  by one stem per line.

### Task file
    ---
    id: a3f9k2
    title: Fix token refresh failing after laptop sleep
    status: inbox
    project: fantasy-madness
    created: 2026-09-15T14:02:00Z
    ---
    ## Description
    Fix token refresh failing after laptop sleep. Happens when the access
    token expires while the machine is suspended.

    ## Plan

    ## Log

### Fields
| Field   | Type   | Required | Mutable | Rules |
|---------|--------|----------|---------|-------|
| id      | string | yes | no  | See Identifiers |
| title   | string | yes | no  | Derived at creation (see below) |
| status  | enum   | yes | yes, via commands only | inbox, proposed, todo, in-progress, done, rejected |
| project | string | yes | no  | See Project resolution |
| created | string | yes | no  | ISO 8601 UTC |

Unknown frontmatter fields are a validation error.

### Title derivation
1. Take the description, trimmed.
2. First sentence = text up to the first newline, or the first `.` `!` `?`
   followed by whitespace, whichever comes first (terminator excluded).
3. If longer than 60 chars, cut at the last space at or before char 60.
   If there is no space, hard-cut at 60.

### Body structure
- `## Description`: original capture text. Written by the human. Claude does
  not edit it.
- `## Plan`: written by Claude during refinement. **Rewritten in place** on
  each revision (history lives in git if committed).
- `## Log`: timestamped lines appended by Claude during implementation,
  format `- <ISO 8601 UTC> — <text>`.
- All three headings must exist; content under them may be empty.

### Project resolution
1. `--project <name>` flag, if given
2. Repo name from the `origin` remote URL (last path segment, `.git` stripped)
3. Name of the git top-level directory
4. Otherwise: exit 1 with
   `Error: not in a git repository. Run inside a repo or pass --project <name>.`

### Archiving
- `done` and `rejected` tasks live in `archive/`. All other statuses live in `active/`.
- Archive order: update `status` in place, then rename into `archive/`
  (atomic on the same filesystem).
- If a task in `active/` has status `done` or `rejected` (interrupted
  archive), `ls` hides it and the next archiving command moves it.
- Restore order: update `status` in place in `archive/`, then rename into `active/`.

### Status transitions
| From → To | Actor | Command |
|---|---|---|
| (new) → inbox | Human | `task add` |
| (new) → proposed | Claude | `task add --proposed` |
| inbox → proposed | Claude | `task propose <ref>` |
| proposed → todo | Human | `task accept <ref>` |
| inbox, proposed → rejected | Human | `task reject <ref>` |
| todo → in-progress | Claude | `task start <ref>` |
| in-progress → done | Human | `task done <ref>` |
| done → todo | Human | `task restore <ref>` |
| rejected → inbox | Human | `task restore <ref>` |

- Any other transition → exit 1:
  `Error: cannot <command> <stem>: status is <current> (expected <allowed>)`
- Actor rules are enforced by convention through the Claude skill, not
  technically.

## 4. Commands

All commands accept `-h/--help`. Output goes to stdout; errors and hints go
to stderr.

### `task add <description> [--project <name>] [--proposed] [--json]`
- Creates a task in `active/` with status `inbox` (or `proposed` with
  `--proposed`). Description goes under `## Description`; `## Plan` and
  `## Log` are empty.
- Output: `Created <stem>`. With `--json`: the task as JSON.
- Errors:
  - Empty/whitespace description → exit 1, `Error: task description required`
  - Project cannot be resolved → see Project resolution

      $ task add "Fix token refresh failing after laptop sleep. Happens when..."
      Created fix-token-refresh-failing-after-laptop-a3f9k2

### `task ls [--all] [--archived] [--status <status>] [--json]`
- Default: active tasks for the current project. Outside a git repo, behaves
  as `--all` (no error, since listing needs no project).
- `--all`: all projects. `--archived`: list `archive/` instead of `active/`.
  `--status`: filter by one status.
- Sort: `created` ascending (oldest first).
- Columns: ID, STATUS, TITLE, PROJECT, AGE (e.g. `3d`, `5h`).
- When filtered to one project, footer on stderr:
  `3 tasks in fantasy-madness · 7 in other projects (--all)`
- `--json`: array of task objects (frontmatter fields plus `stem`), no footer.
- No tasks → stderr `No tasks.`, exit 0.

### `task show <ref> [--json]`
- Prints the full task file as-is. With `--json`: frontmatter fields, `stem`,
  and `body`.

### `task propose <ref>`
- inbox → proposed.
- Error if `## Plan` is empty: exit 1,
  `Error: cannot propose <stem>: Plan section is empty`

### `task accept <ref>` / `task reject <ref>` / `task start <ref>` / `task done <ref>` / `task restore <ref>`
- Apply the transition from the table. Output: `<stem>: <old> → <new>`.
- `reject` and `done` archive; `restore` un-archives.

### `task edit <ref>`
- Opens the file in `$VISUAL`, else `$EDITOR`, else `vi`.
- On editor exit, validates. If invalid, or any immutable field changed:
  restore the original file content and exit 1 with the reason.
- Requires an interactive terminal; otherwise exit 1:
  `Error: edit requires an interactive terminal`

### `task review`
- Interactive only. If stdin is not a TTY, exit 1:
  `Error: review is interactive. Use accept/reject/edit instead.`
- Iterates over active `inbox` and `proposed` tasks (all projects), oldest first.
- For each, shows the task and prompts: `[a]ccept [r]eject [e]dit [s]kip [q]uit`
  - `accept` only offered for `proposed`.
  - Actions call the same code paths as the standalone commands.
- Ends with a summary: `Accepted 2, rejected 1, skipped 3`.

## 5. Conventions

### Exit codes
| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | User error: bad arguments, lookup failure, invalid transition, not a repo, no TTY |
| 2 | Data error: a task file fails validation |

### Validation
- Every command validates each file it reads.
- Invalid file → exit 2: `Error: <filename>: <field> <problem>`
- `ls` stops on the first invalid file (v1 favors loud failure over partial output).

### Concurrency
- No locking in v1. Last write wins. Acceptable for a single user.

## 6. Claude integration
- Skill source: `skill/SKILL.md` in this repo, symlinked to
  `~/.claude/skills/task-cli/`.
- The skill instructs Claude to:
  - Change status only through CLI commands, never by editing frontmatter.
  - Edit only the `## Plan` and `## Log` sections directly.
  - Before writing a Plan, read the repo, its `CLAUDE.md`, and archived tasks
    for the project (`task ls --archived --json`).
  - Rewrite the Plan in place when revising.
  - Never run `accept`, `reject`, `done`, or `restore`.
  - Use `--json` output when reading tasks.

## 7. Decisions
- Markdown files as source of truth: Claude can read/edit natively; git for history.
- Central `~/tasks` over per-repo storage: simple cross-project listing.
- Random IDs over sequential: avoids collisions across machines/branches.
- `<slug>-<id>` filenames: readable for display; short id prefix for input.
- Deterministic titles over LLM titles: capture must be instant and offline.
- Titles and filenames immutable: stable references.
- Project from origin remote, then folder name: stable across clones/worktrees.
- `--project` escape hatch: capture must not fail outside a repo.
- Project-scoped `ls` by default, with a stderr footer so hidden tasks stay visible.
- No priority in v1: minimize data entry at capture.
- Archive folder over status filtering: no auto-commit means deletion risks
  loss; archived tasks give Claude project history.
- Human owns accept, reject, done, restore: keeps approval and completion gates.
- Plan rewritten in place: readability over in-file history.
- Every command also works non-interactively: Claude runs in a non-TTY shell.
- Format protection in code (validation), guidance in the skill.

## 8. Open questions
- Restore targets: done → todo and rejected → inbox. Confirm after real use.
- Should `ls` skip invalid files with a warning instead of failing?
- Automatic git commit of the data directory (post-v1).
- `task next` and title substring lookup (post-v1).
- MCP server tool surface (Phase 3).
