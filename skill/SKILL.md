---
name: task-cli
description: Read, plan, and progress coding tasks stored as markdown by task-cli. Use when the user mentions a task id or stem, asks what is in the inbox or backlog, asks you to plan or propose work, or asks you to start or log progress on a task.
---

# task-cli

Tasks live as markdown files under `~/tasks/` (`TASKS_DIR` overrides the root),
split into `active/` and `archive/`. The `task` command is the only supported
way to change a task's status.

## The loop

Planning is a joint effort with a human approval gate in the middle:

1. The human captures a task (`task add`) — it lands in `inbox`.
2. **You** write a Plan and `task propose` it.
3. **The human** reviews and runs `task accept` (or `task reject`).
4. **You** run `task start`, implement, and log progress.
5. **The human** confirms with `task done`.

## Rules

**Never run `accept`, `reject`, `done`, or `restore`.** Those four commands are
the human's approval and completion gates. If work looks finished, say so and
let the human run `task done`.

**Change status only through CLI commands.** Never edit the `status` field — or
any frontmatter field — by hand. `id`, `title`, `project`, and `created` are
immutable, and the tool restores the file if you change them.

**Edit only `## Plan` and `## Log`.**
- `## Description` is the human's. Do not touch it.
- `## Plan` is yours. **Rewrite it in place** when revising; do not append a
  second plan or leave the old one behind.
- `## Log` is append-only: `- <ISO 8601 UTC> — <text>`.

**Use `--json` when reading tasks.** `task ls --json` and `task show <ref> --json`
give you structured output; the table format is for humans.

## Before writing a Plan

Read the repo and its `CLAUDE.md`, then look at what has already been done for
this project:

```bash
task ls --archived --json      # completed and rejected work, for context
task show <ref> --json         # the task you are planning
```

A plan that repeats rejected work, or ignores a convention the repo already
follows, wastes the human's review.

## Commands

```bash
task ls [--all] [--archived] [--status <status>] [--json]
task show <ref> [--json]
task propose <ref>     # inbox → proposed; fails if ## Plan is empty
task start <ref>       # todo → in-progress
task add "<text>" [--project <name>] [--proposed]
```

`<ref>` is a filename stem, an exact id, or a unique id prefix of at least
three characters.

## Statuses

`inbox` → `proposed` → `todo` → `in-progress` → `done`, with `rejected` as an
exit from `inbox` or `proposed`. `done` and `rejected` tasks move to `archive/`
automatically.

## Exit codes

`0` success · `1` user error (bad ref, invalid transition, not in a repo) ·
`2` a task file failed validation — report it rather than trying to repair the
file by hand.
