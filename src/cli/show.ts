import { readFile } from "node:fs/promises";
import { resolveRef } from "../core/lookup.js";
import { toJson } from "./format.js";

export interface ShowOptions {
  json?: boolean;
}

export async function showCommand(ref: string, options: ShowOptions): Promise<void> {
  // resolveRef validates the file; for the default output we then print the
  // original bytes rather than re-serialising, so `show` never reformats.
  const file = await resolveRef(ref);

  if (options.json === true) {
    console.log(JSON.stringify({ ...toJson(file), body: file.body }, null, 2));
    return;
  }

  process.stdout.write(await readFile(file.path, "utf8"));
}
