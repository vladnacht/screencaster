#!/usr/bin/env node
// End-to-end check of the demo-capture MCP server, driven over stdio like Claude does:
// record the bundled demo app, take a screenshot, finalize both, and assert on the output.
// Usage: node scripts/e2e.mjs   (writes into $DEMO_AGENT_OUTPUT_DIR, default a temp folder)
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverDir = path.join(root, "mcp", "demo-capture");
const require = createRequire(path.join(serverDir, "package.json"));
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");

const outDir = process.env.DEMO_AGENT_OUTPUT_DIR ?? fs.mkdtempSync(path.join(os.tmpdir(), "demo-agent-e2e-"));
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(serverDir, "dist", "server.js")],
  env: { ...process.env, DEMO_AGENT_OUTPUT_DIR: outDir, DEMO_AGENT_STEP_PAUSE_MS: "400" },
  stderr: "inherit",
});
const client = new Client({ name: "e2e", version: "0.0.0" });
await client.connect(transport);

async function call(name, args = {}) {
  const res = await client.callTool({ name, arguments: args });
  const text = res.content?.[0]?.text ?? "";
  if (res.isError) throw new Error(`${name}: ${text}`);
  try { return JSON.parse(text); } catch { return text; }
}

const t0 = Date.now();
console.log("check_setup", await call("check_setup"));
await call("open_target", { source: "launch", url: path.join(root, "examples", "demo-app", "index.html") });
console.log((await call("snapshot")).split("\n").slice(0, 6).join("\n"));

// Whole storyboard in one server-side call: the 2.5 s toast must be caught by `expect`.
const rec = await call("run_storyboard", {
  steps: [
    { action: "type", selector: "#name", value: "Ada Lovelace", caption: "Créer un contact", label: "Nom" },
    { action: "type", role: "textbox", name: "Email", value: "ada@example.com", caption: null },
    { action: "click", text: "Enregistrer", caption: "On enregistre", expect: { text: "Contact enregistré", timeoutMs: 3000 } },
    { action: "screenshot" },
  ],
  holdMs: 1200,
});
console.log("run_storyboard", { ...rec, steps: rec.steps?.map((s) => `${s.t}s ${s.label}`) });
assert.equal(rec.status, "ok");
assert.ok(rec.durationSec > 3 && rec.durationSec < 15, `duration ${rec.durationSec}`);
assert.equal(rec.steps.length, 4);
assert.equal(rec.rawShots.length, 1);

const frames = await call("extract_frames", { count: 3 });
assert.equal(frames.length, 3);
assert.ok(frames.every((f) => fs.statSync(f.file).size > 1000));


const video = await call("finalize", {
  kind: "video", project: "Demo App", featureSlug: "Créer un contact", description: "Création d'un contact avec toast",
  trimStart: 0.3, qa: { verdict: "ok", issues: [] },
});
console.log("finalize video", video);
assert.match(path.basename(video.file), /^\d{4}-\d{2}-\d{2}_\d{4}_demo-app_creer-un-contact_video_1440x900\.mp4$/);
assert.ok(fs.statSync(video.file).size < 8 * 1024 * 1024);
assert.ok(fs.existsSync(video.poster) && fs.existsSync(video.meta));
const meta = JSON.parse(fs.readFileSync(video.meta, "utf8"));
assert.equal(meta.steps.length, 4);

const shots = await call("finalize", { kind: "shot", project: "Demo App", featureSlug: "contact-saved", description: "Liste après ajout" });
console.log("finalize shot", shots);
assert.match(path.basename(shots.files[0].file), /_demo-app_contact-saved_shot_1440x900\.png$/);

// A failing step stops the recording and reports the step with a page snapshot.
const bad = await call("run_storyboard", { steps: [{ n: 7, action: "click", selector: "#does-not-exist" }], holdMs: 0 });
assert.equal(bad.status, "failed");
assert.equal(bad.failedStep.n, 7);
assert.match(bad.failedStep.snapshot, /URL:/);
assert.ok(bad.rawVideo, "recording must be stopped and returned on failure");
await call("finalize", { kind: "shot", project: "Demo App", featureSlug: "skip", description: "flush" }).catch(() => {});

// Same name a second time → collision suffix.
await call("screenshot", {});
const again = await call("finalize", { kind: "shot", project: "Demo App", featureSlug: "contact-saved", description: "x" });
assert.notEqual(again.files[0].file, shots.files[0].file);

await call("close_target");
await client.close();
console.log(`\nOK en ${((Date.now() - t0) / 1000).toFixed(1)} s — sorties dans ${outDir}`);
