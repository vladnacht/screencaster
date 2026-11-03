import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { runFfmpeg } from "../encode.js";

test("finalize writes only images into images/, and ffmpeg tools refuse files the server did not write", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "demo-finalize-"));
  const page = path.join(dir, "page.html");
  fs.writeFileSync(page, "<title>t</title><h1>Hello</h1>");
  const outside = path.join(dir, "outside.png");
  await runFfmpeg(["-f", "lavfi", "-i", "color=c=red:s=200x100", "-frames:v", "1", outside]);

  const server = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "server.js");
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(new StdioClientTransport({
    command: process.execPath, args: [server], env: { ...process.env, SCREENCASTER_OUTPUT_DIR: path.join(dir, "out") } as Record<string, string>,
  }));
  const call = async (name: string, args: Record<string, unknown>) => {
    const res = await client.callTool({ name, arguments: args });
    return { isError: Boolean(res.isError), text: (res.content as { text: string }[])[0].text };
  };
  try {
    const opened = await call("open_target", { source: "launch", url: page, width: 480, height: 360 });
    assert.ok(!opened.isError, opened.text);
    const finalize = async () => {
      assert.ok(!(await call("screenshot", {})).isError);
      const r = await call("finalize", { kind: "shot", project: "p", featureSlug: "f" });
      assert.ok(!r.isError, r.text);
      return (JSON.parse(r.text) as { files: { file: string }[] }).files[0].file;
    };
    // Two batches in the same minute get their own PNG, and the folder holds nothing else.
    const a = await finalize();
    const b = await finalize();
    assert.notEqual(a, b);
    const imagesDir = path.dirname(a);
    assert.equal(path.basename(imagesDir), "images");
    assert.deepEqual(fs.readdirSync(imagesDir).sort(), [path.basename(a), path.basename(b)].sort());
    assert.deepEqual(fs.readdirSync(path.dirname(imagesDir)), ["images"]);
    // A model-given path (local file or URL) never reaches ffmpeg.
    for (const file of [outside, "http://127.0.0.1:9/playlist.m3u8"]) {
      const shot = await call("finalize", { kind: "shot", project: "p", featureSlug: "f", rawFiles: [file] });
      assert.ok(shot.isError && shot.text.includes("Fichier refusé"), shot.text);
      const frames = await call("extract_frames", { file });
      assert.ok(frames.isError && frames.text.includes("Fichier refusé"), frames.text);
    }
  } finally {
    await call("close_target", {}).catch(() => {});
    await client.close();
  }
});
