import type { Task, TaskFile } from "../core/task.js";

/**
 * Presentation only. Nothing here touches the filesystem or decides policy —
 * that all lives in `src/core`.
 */

/** Compact relative age for the AGE column: `45m`, `5h`, `3d`. */
export function formatAge(created: string, now: Date = new Date()): string {
  const then = Date.parse(created);
  if (Number.isNaN(then)) return "?";

  const minutes = Math.max(0, Math.floor((now.getTime() - then) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** A task as it appears in `--json` output: frontmatter fields plus `stem`. */
export function toJson(file: TaskFile): Task & { stem: string } {
  return { ...file.task, stem: file.stem };
}

const COLUMNS = ["ID", "STATUS", "TITLE", "PROJECT", "AGE"] as const;

/** Render the `ls` table with columns padded to their widest cell. */
export function formatTable(files: TaskFile[], now: Date = new Date()): string {
  const rows = files.map((file) => [
    file.task.id,
    file.task.status,
    file.task.title,
    file.task.project,
    formatAge(file.task.created, now),
  ]);

  const widths = COLUMNS.map((heading, index) =>
    rows.reduce((max, row) => Math.max(max, (row[index] ?? "").length), heading.length),
  );

  const render = (cells: readonly string[]): string =>
    cells
      // The last column is not padded, so lines have no trailing whitespace.
      .map((cell, index) => (index === cells.length - 1 ? cell : cell.padEnd(widths[index] ?? 0)))
      .join("  ")
      .trimEnd();

  return [render(COLUMNS), ...rows.map(render)].join("\n");
}

/** The stderr footer shown when `ls` is scoped to a single project. */
export function formatFooter(shown: number, project: string, others: number): string {
  const plural = (n: number): string => (n === 1 ? "task" : "tasks");
  return `${shown} ${plural(shown)} in ${project} · ${others} in other projects (--all)`;
}
