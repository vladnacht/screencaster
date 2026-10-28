import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** `$SCREENCASTER_FFMPEG`, else the bundled ffmpeg-static binary, else `ffmpeg` on PATH. */
export function ffmpegPath(): string {
  if (process.env.SCREENCASTER_FFMPEG) return process.env.SCREENCASTER_FFMPEG;
  try {
    const bundled = require("ffmpeg-static") as string | null;
    if (bundled && fs.existsSync(bundled)) return bundled;
  } catch {
    // not installed: fall through to PATH
  }
  return "ffmpeg";
}

export function checkFfmpeg(): string | null {
  const r = spawnSync(ffmpegPath(), ["-hide_banner", "-encoders"], { encoding: "utf8" });
  if (r.error || r.status !== 0) {
    return "ffmpeg introuvable. Lance `node scripts/setup.mjs` dans le plugin, ou installe ffmpeg (brew install ffmpeg).";
  }
  if (!r.stdout.includes("libx264")) return "Cet ffmpeg n'a pas libx264 : définis SCREENCASTER_FFMPEG vers un build complet.";
  return null;
}

export function runFfmpeg(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath(), ["-hide_banner", "-y", ...args], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    p.stderr.on("data", (d) => (stderr += d));
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0 ? resolve(stderr) : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-1500)}`)),
    );
  });
}

/** Duration in seconds, read from ffmpeg's banner (no ffprobe needed). */
export async function probeDuration(file: string): Promise<number> {
  const r = spawnSync(ffmpegPath(), ["-hide_banner", "-i", file], { encoding: "utf8" });
  const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(r.stderr ?? "");
  if (!m) throw new Error(`Durée illisible pour ${file}`);
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/** No video ever leaves finalize above this, whatever maxMb or the duration. */
export const HARD_MAX_MB = 10;

export interface VideoOptions {
  format: "mp4" | "mkv";
  /** Target ceiling on the output size, in MB; clamped to HARD_MAX_MB. */
  maxMb: number;
  fps: number;
  maxWidth: number;
  crf: number;
  trimStart?: number;
  trimEnd?: number;
}

export const defaultVideoOptions = (): VideoOptions => ({
  format: "mp4",
  maxMb: Number(process.env.SCREENCASTER_MAX_MB ?? 8),
  fps: 15,
  maxWidth: 1280,
  crf: 28,
});

function videoFilter(o: VideoOptions): string {
  // No mpdecimate: it shortens the final hold (the result screen). x264 already spends
  // almost nothing on static frames.
  return [`fps=${o.fps}`, `scale='min(${o.maxWidth},iw)':-2:flags=lanczos`].join(",");
}

function trimArgs(o: VideoOptions): string[] {
  const args: string[] = [];
  if (o.trimStart && o.trimStart > 0) args.push("-ss", o.trimStart.toFixed(2));
  if (o.trimEnd && o.trimEnd > 0) args.push("-to", o.trimEnd.toFixed(2));
  return args;
}

const containerArgs = (o: VideoOptions) => (o.format === "mp4" ? ["-movflags", "+faststart"] : []);
const x264 = ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "slow", "-an"];

export interface EncodeResult {
  file: string;
  sizeBytes: number;
  durationSec: number;
  passes: 1 | 2;
  /** The ceiling actually applied, after clamping. */
  maxMb: number;
  /** Width/fps actually used (lower than requested when the size cap forced it). */
  width: number;
  fps: number;
}

async function twoPass(input: string, output: string, o: VideoOptions, kbps: number): Promise<void> {
  const passlog = path.join(os.tmpdir(), `screencaster-2pass-${process.pid}-${Date.now()}`);
  const nullOut = process.platform === "win32" ? "NUL" : "/dev/null";
  const common = [...trimArgs(o), "-i", input, "-vf", videoFilter(o), ...x264, "-b:v", `${kbps}k`, "-maxrate", `${kbps}k`, "-bufsize", `${kbps * 2}k`, "-passlogfile", passlog];
  try {
    await runFfmpeg([...common, "-pass", "1", "-f", o.format === "mp4" ? "mp4" : "matroska", nullOut]);
    await runFfmpeg([...common, "-pass", "2", ...containerArgs(o), output]);
  } finally {
    for (const f of fs.readdirSync(path.dirname(passlog))) {
      if (f.startsWith(path.basename(passlog))) fs.rmSync(path.join(path.dirname(passlog), f), { force: true });
    }
  }
}

/**
 * Re-encode a raw recording into a small H.264 file. CRF first; if the result is
 * above the ceiling, redo it in two passes at the bitrate that fits, and keep lowering
 * bitrate, width and fps until it does. Throws rather than deliver an oversized file.
 */
export async function encodeVideo(input: string, output: string, o: VideoOptions): Promise<EncodeResult> {
  const maxMb = o.maxMb > 0 ? Math.min(o.maxMb, HARD_MAX_MB) : HARD_MAX_MB;
  const limit = maxMb * 1024 * 1024;
  await runFfmpeg([...trimArgs(o), "-i", input, "-vf", videoFilter(o), ...x264, "-crf", String(o.crf), ...containerArgs(o), output]);

  let size = fs.statSync(output).size;
  const durationSec = await probeDuration(output);
  if (size <= limit) return { file: output, sizeBytes: size, durationSec, passes: 1, maxMb, width: o.maxWidth, fps: o.fps };

  // No bitrate floor: a long video needs a very low one to fit.
  let kbps = (limit * 8 * 0.9) / durationSec / 1000;
  let cur = { ...o };
  for (let attempt = 1; ; attempt++) {
    await twoPass(input, output, cur, Math.max(1, Math.floor(kbps)));
    size = fs.statSync(output).size;
    if (size <= limit) break;
    if (attempt === 8) {
      fs.rmSync(output, { force: true });
      throw new Error(`Impossible de descendre sous ${maxMb} Mo (${(size / 1048576).toFixed(1)} Mo à ${cur.maxWidth}px ${cur.fps} fps) : coupe la vidéo avec trimStart/trimEnd.`);
    }
    // x264 overshoots tiny bitrates (per-frame overhead): aim lower and shrink the picture.
    kbps *= (limit / size) * 0.9;
    cur = { ...cur, maxWidth: Math.max(320, Math.round((cur.maxWidth * 0.75) / 2) * 2), fps: Math.max(5, cur.fps - 3) };
  }
  return { file: output, sizeBytes: size, durationSec: await probeDuration(output), passes: 2, maxMb, width: cur.maxWidth, fps: cur.fps };
}

/** Small PNG thumbnail taken at `atSec`. */
export async function extractPoster(video: string, output: string, atSec: number, width = 640): Promise<string> {
  await runFfmpeg([
    "-ss", Math.max(0, atSec).toFixed(2), "-i", video, "-frames:v", "1",
    "-vf", `scale='min(${width},iw)':-2`, "-compression_level", "9", output,
  ]);
  return output;
}

/** `count` frames spread over the video (or at the given timestamps), for visual QA. */
export async function extractFrames(video: string, outDir: string, count = 5, at?: number[]): Promise<{ t: number; file: string }[]> {
  fs.mkdirSync(outDir, { recursive: true });
  const duration = await probeDuration(video);
  const times = at?.length ? at : Array.from({ length: count }, (_, i) => (duration * (i + 0.5)) / count);
  const frames = [];
  for (const [i, t] of times.entries()) {
    const file = path.join(outDir, `frame_${String(i + 1).padStart(2, "0")}_${t.toFixed(1)}s.png`);
    await extractPoster(video, file, Math.min(t, Math.max(0, duration - 0.05)), 960);
    frames.push({ t: Number(t.toFixed(2)), file });
  }
  return frames;
}

/** Re-compress a PNG losslessly; keeps whichever file is smaller. */
export async function optimizePng(input: string, output: string): Promise<number> {
  const tmp = `${output}.tmp.png`;
  await runFfmpeg(["-i", input, "-compression_level", "9", "-pred", "mixed", tmp]);
  const [a, b] = [fs.statSync(input).size, fs.statSync(tmp).size];
  if (b < a) fs.renameSync(tmp, output);
  else {
    fs.copyFileSync(input, output);
    fs.rmSync(tmp, { force: true });
  }
  return fs.statSync(output).size;
}
