import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { HARD_MAX_MB, defaultVideoOptions, encodeVideo, probeDuration, runFfmpeg } from "../encode.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "demo-encode-"));

test("a 30 s UI-like 1440x900 recording ends up under the 8 MB default", async () => {
  // Mostly static frame with a moving box: what a UI screencast looks like.
  const raw = path.join(dir, "ui.mp4");
  await runFfmpeg([
    "-f", "lavfi", "-i", "color=c=0xf6f5f2:s=1440x900:r=15:d=30",
    "-f", "lavfi", "-i", "testsrc2=s=320x200:r=15:d=30",
    "-filter_complex", "[0][1]overlay=x='mod(t*120,1100)':y=300",
    "-c:v", "libx264", "-preset", "ultrafast", "-crf", "18", "-pix_fmt", "yuv420p", raw,
  ]);
  const out = path.join(dir, "ui-final.mp4");
  const res = await encodeVideo(raw, out, { ...defaultVideoOptions(), maxMb: 50 });
  assert.equal(res.maxMb, HARD_MAX_MB, "a larger maxMb is clamped to the hard ceiling");
  assert.ok(res.sizeBytes < 8 * 1024 * 1024, `size ${res.sizeBytes}`);
  assert.equal(res.passes, 1);
  assert.ok(Math.abs(res.durationSec - 30) < 0.5, `duration ${res.durationSec}`);
});

test("two passes, then smaller size and fps, until the file fits maxMb; trims", async () => {
  const raw = path.join(dir, "noise.mp4");
  await runFfmpeg([
    "-f", "lavfi", "-i", "testsrc2=s=1280x720:r=15:d=12,noise=alls=40:allf=t",
    "-c:v", "libx264", "-preset", "ultrafast", "-crf", "18", "-pix_fmt", "yuv420p", raw,
  ]);
  const out = path.join(dir, "noise-final.mkv");
  const res = await encodeVideo(raw, out, { ...defaultVideoOptions(), format: "mkv", maxMb: 0.5, trimStart: 1, trimEnd: 11 });
  assert.equal(res.passes, 2);
  assert.ok(res.sizeBytes <= 0.5 * 1024 * 1024, `size ${res.sizeBytes} at ${res.width}px ${res.fps}fps`);
  assert.ok(Math.abs((await probeDuration(out)) - 10) < 0.5);
});

test("a long video still fits: the bitrate goes below the old 100 kbps floor", async () => {
  // 90 s of noisy content for 0.4 MB needs about 33 kbps.
  const raw = path.join(dir, "long.mp4");
  await runFfmpeg([
    "-f", "lavfi", "-i", "testsrc2=s=640x360:r=15:d=90,noise=alls=20:allf=t",
    "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23", "-pix_fmt", "yuv420p", raw,
  ]);
  const out = path.join(dir, "long-final.mp4");
  const res = await encodeVideo(raw, out, { ...defaultVideoOptions(), maxMb: 0.4 });
  assert.ok(res.sizeBytes <= 0.4 * 1024 * 1024, `size ${res.sizeBytes} at ${res.width}px ${res.fps}fps`);
  assert.ok(Math.abs(res.durationSec - 90) < 0.5, `duration ${res.durationSec}`);
});
