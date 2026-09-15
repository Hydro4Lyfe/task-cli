#!/usr/bin/env node
import { Command } from "commander";
import { DataError, UserError } from "../core/errors.js";
import { TRANSITION_COMMANDS, type TransitionCommand } from "../core/transitions.js";
import { addCommand } from "./add.js";
import { editCommand } from "./edit.js";
import { lsCommand } from "./ls.js";
import { reviewCommand } from "./review.js";
import { showCommand } from "./show.js";
import { statusCommand } from "./status.js";

/** One-line help text for each status command, taken from the spec's table. */
const TRANSITION_HELP: Record<TransitionCommand, string> = {
  propose: "inbox → proposed (Claude; requires a non-empty Plan)",
  accept: "proposed → todo (human)",
  reject: "inbox or proposed → rejected, archived (human)",
  start: "todo → in-progress (Claude)",
  done: "in-progress → done, archived (human)",
  restore: "done → todo, or rejected → inbox, un-archived (human)",
};

function buildProgram(): Command {
  const program = new Command();

  program
    .name("task")
    .description("Capture coding tasks from the terminal as markdown files.")
    .version("1.0.0");

  program
    .command("add")
    .argument("<description>", "the capture text; the title is derived from its first sentence")
    .option("--project <name>", "override the project inferred from git")
    .option("--proposed", "create with status proposed instead of inbox")
    .option("--json", "output the created task as JSON")
    .description("Create a task in active/")
    .action(addCommand);

  program
    .command("ls")
    .option("--all", "all projects, not just the current one")
    .option("--archived", "list archive/ instead of active/")
    .option("--status <status>", "filter by a single status")
    .option("--json", "output an array of task objects")
    .description("List tasks, oldest first")
    .action(lsCommand);

  program
    .command("show")
    .argument("<ref>", "filename stem, exact id, or unique id prefix")
    .option("--json", "output frontmatter, stem and body as JSON")
    .description("Print a task in full")
    .action(showCommand);

  // The six status commands differ only by name, so they are registered from
  // the same table that defines the transitions themselves.
  for (const command of TRANSITION_COMMANDS) {
    program
      .command(command)
      .argument("<ref>", "filename stem, exact id, or unique id prefix")
      .description(TRANSITION_HELP[command])
      .action((ref: string) => statusCommand(command, ref));
  }

  program
    .command("edit")
    .argument("<ref>", "filename stem, exact id, or unique id prefix")
    .description("Open a task in $VISUAL, $EDITOR, or vi")
    .action(editCommand);

  program
    .command("review")
    .description("Step through inbox and proposed tasks interactively")
    .action(reviewCommand);

  return program;
}

/**
 * The only place the process exits. Core throws `UserError` (exit 1) or
 * `DataError` (exit 2); anything else is a genuine bug and is re-thrown with
 * its stack intact rather than being flattened into an exit code.
 */
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

await main();
