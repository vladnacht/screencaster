import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type MediaKind = "video" | "shot";

/** Lowercase kebab-case, ASCII only, `max` chars at most. */
export function slugify(input: string, max = 48): string {
  const slug = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
  return slug || "demo";
}

const pad = (n: number) => String(n).padStart(2, "0");

export function formatDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * The file name, without extension: only the explicit title, since the folder already
 * holds the project, the date and the media type. `index` numbers screenshots of one take.
 */
export function buildBaseName(title: string, index?: number): string {
  return index === undefined ? slugify(title, 80) : `${slugify(title, 80)}-${index}`;
}

/**
 * Root folder for every demo: `$SCREENCASTER_OUTPUT_DIR`, else `<home>/Documents/Demos`.
 * `home` is injectable for tests.
 */
export function outputRoot(dir: string | undefined = process.env.SCREENCASTER_OUTPUT_DIR, home: string = os.homedir()): string {
  if (dir) return path.resolve(dir);
  return path.join(home, "Documents", "Demos");
}

/** `<root>/<project>/<date>/videos` or `…/images`: only the media files, nothing else. */
export function outputDir(project: string, kind: MediaKind, date: Date = new Date(), root: string = outputRoot()): string {
  return path.join(root, slugify(project), formatDate(date), kind === "video" ? "videos" : "images");
}

/** True when `file` is inside `dir`, symlinks resolved; both must exist. */
export function isInside(dir: string, file: string): boolean {
  const rel = path.relative(fs.realpathSync(dir), fs.realpathSync(file));
  return rel !== "" && rel.split(path.sep)[0] !== ".." && !path.isAbsolute(rel);
}

/** First free path among `<base>.<ext>`, `<base>_2.<ext>`, `<base>_3.<ext>`… */
export function uniquePath(dir: string, base: string, ext: string, exists: (p: string) => boolean = fs.existsSync): string {
  const clean = ext.replace(/^\./, "");
  let candidate = path.join(dir, `${base}.${clean}`);
  for (let n = 2; exists(candidate); n++) candidate = path.join(dir, `${base}_${n}.${clean}`);
  return candidate;
}
