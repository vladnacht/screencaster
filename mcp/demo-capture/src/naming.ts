import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type MediaKind = "video" | "shot";

export interface NameParts {
  project: string;
  featureSlug: string;
  kind: MediaKind;
  width: number;
  height: number;
  ext: string;
  /** 1-based index when several screenshots belong to the same demo. */
  index?: number;
  date?: Date;
}

/** Lowercase kebab-case, ASCII only, max 48 chars. */
export function slugify(input: string): string {
  const slug = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return slug || "demo";
}

const pad = (n: number) => String(n).padStart(2, "0");

export function formatDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `<YYYY-MM-DD>_<HHmm>_<project>_<feature>_<video|shot>[_<n>]_<WxH>` (no extension). */
export function buildBaseName(p: NameParts): string {
  const d = p.date ?? new Date();
  const parts = [
    formatDate(d),
    `${pad(d.getHours())}${pad(d.getMinutes())}`,
    slugify(p.project),
    slugify(p.featureSlug),
    p.kind,
  ];
  if (p.index !== undefined) parts.push(String(p.index));
  parts.push(`${Math.round(p.width)}x${Math.round(p.height)}`);
  return parts.join("_");
}

/**
 * Root folder for every demo: `$DEMO_AGENT_OUTPUT_DIR`, else `<home>/Documents/Demos`.
 * `home` is injectable for tests.
 */
export function outputRoot(env: NodeJS.ProcessEnv = process.env, home: string = os.homedir()): string {
  if (env.DEMO_AGENT_OUTPUT_DIR) return path.resolve(env.DEMO_AGENT_OUTPUT_DIR);
  return path.join(home, "Documents", "Demos");
}

export function outputDir(project: string, date: Date = new Date(), root: string = outputRoot()): string {
  return path.join(root, slugify(project), formatDate(date));
}

/** First free path among `<base>.<ext>`, `<base>_2.<ext>`, `<base>_3.<ext>`… */
export function uniquePath(dir: string, base: string, ext: string, exists: (p: string) => boolean = fs.existsSync): string {
  const clean = ext.replace(/^\./, "");
  let candidate = path.join(dir, `${base}.${clean}`);
  for (let n = 2; exists(candidate); n++) candidate = path.join(dir, `${base}_${n}.${clean}`);
  return candidate;
}
