import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { UserError } from "../core/errors.js";
import { listTaskFiles } from "../core/storage.js";
import { editCommand } from "./edit.js";
import { applyTransition } from "./status.js";

/**
 * A thin interactive wrapper. Every action delegates to the same functions the
 * standalone commands use, so review can never apply a transition the CLI
 * would reject (spec section 4).
 */
export async function reviewCommand(): Promise<void> {
  if (!process.stdin.isTTY) {
    throw new UserError("review is interactive. Use accept/reject/edit instead.");
  }

  const queue = (await listTaskFiles("active")).filter(
    (file) => file.task.status === "inbox" || file.task.status === "proposed",
  );

  if (queue.length === 0) {
    console.error("No tasks to review.");
    return;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  // On EOF readline closes without settling a pending question, which would
  // hang the process. Race the question against the close event instead.
  let closed = false;
  rl.on("close", () => {
    closed = true;
  });
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

  let accepted = 0;
  let rejected = 0;
  let skipped = 0;

  try {
    for (const file of queue) {
      console.log("");
      process.stdout.write(await readFile(file.path, "utf8"));

      // `accept` only applies to proposed tasks, so it is not offered for inbox.
      const canAccept = file.task.status === "proposed";
      const prompt = `${canAccept ? "[a]ccept " : ""}[r]eject [e]dit [s]kip [q]uit `;

      let done = false;
      while (!done) {
        const raw = await ask(prompt);
        if (raw === null) {
          // Ctrl-D behaves like `q`.
          console.log(summary(accepted, rejected, skipped));
          return;
        }
        switch (raw.trim().toLowerCase()) {
          case "a":
            if (!canAccept) {
              console.error("accept applies to proposed tasks only.");
              break;
            }
            console.log((await applyTransition("accept", file.stem)).line);
            accepted++;
            done = true;
            break;
          case "r":
            console.log((await applyTransition("reject", file.stem)).line);
            rejected++;
            done = true;
            break;
          case "e":
            await editCommand(file.stem);
            skipped++;
            done = true;
            break;
          case "s":
            skipped++;
            done = true;
            break;
          case "q":
            console.log(summary(accepted, rejected, skipped));
            return;
          default:
            console.error("Choose one of a, r, e, s, q.");
        }
      }
    }
  } finally {
    rl.close();
  }

  console.log(summary(accepted, rejected, skipped));
}

function summary(accepted: number, rejected: number, skipped: number): string {
  return `Accepted ${accepted}, rejected ${rejected}, skipped ${skipped}`;
}
