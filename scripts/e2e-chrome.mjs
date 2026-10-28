#!/usr/bin/env node
// Attach-mode check: a Chrome with a debug port and two tabs; list them, attach by
// title, record a scroll, screenshot, finalize, detach, and check Chrome kept its tabs.
// Usage: node scripts/e2e-chrome.mjs   (starts a headless Chrome on port 9333 and stops it)
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverDir = path.join(root, "mcp", "demo-capture");
const require = createRequire(path.join(serverDir, "package.json"));
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");
const { chromium } = require("playwright");

const port = 9333;
const cdpUrl = `http://127.0.0.1:${port}`;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "screencaster-chrome-"));
const outDir = process.env.SCREENCASTER_OUTPUT_DIR ?? fs.mkdtempSync(path.join(os.tmpdir(), "screencaster-e2e-"));
const app = pathToFileURL(path.join(root, "examples", "demo-app", "index.html")).href;
const other = "data:text/html,<title>Autre onglet</title><h1>Rien à voir</h1>";

// The user's Chrome if present (what chrome-debug.sh starts), else Playwright's Chromium.
const macChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const exe = process.env.SCREENCASTER_CHROME ?? (fs.existsSync(macChrome) ? macChrome : chromium.executablePath());
const chrome = spawn(exe, [
  "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--window-size=1280,800", "--no-first-run", app,
], { stdio: process.env.E2E_DEBUG ? "inherit" : "ignore" });
if (process.env.E2E_DEBUG) chrome.on("exit", (c) => console.error("chrome exited", c));
for (let i = 0; i < 50; i++) {
  try { await fetch(`${cdpUrl}/json/version`); break; } catch { await new Promise((r) => setTimeout(r, 200)); }
}
// Headless Chrome takes a single URL on the command line: open the second tab over CDP.
await fetch(`${cdpUrl}/json/new?${encodeURI(other)}`, { method: "PUT" });

const client = new Client({ name: "e2e-chrome", version: "0.0.0" });
await client.connect(new StdioClientTransport({
  command: process.execPath,
  args: [path.join(serverDir, "dist", "server.js")],
  env: { ...process.env, SCREENCASTER_OUTPUT_DIR: outDir, SCREENCASTER_STEP_PAUSE_MS: "300" },
  stderr: "inherit",
}));
async function call(name, args = {}) {
  const res = await client.callTool({ name, arguments: args });
  const text = res.content?.[0]?.text ?? "";
  if (res.isError) throw new Error(`${name}: ${text}`);
  try { return JSON.parse(text); } catch { return text; }
}

try {
  const tabs = await call("list_targets", { cdpUrl });
  console.log("list_targets", tabs);
  const target = tabs.find((t) => t.title.includes("Contacts"));
  assert.ok(target, "demo tab not listed");

  // Ambiguous match must be refused, not guessed.
  await assert.rejects(call("open_target", { source: "chrome", cdpUrl, match: "e" }), /Plusieurs onglets/);

  const opened = await call("open_target", { source: "chrome", cdpUrl, targetId: target.targetId });
  console.log("open_target", opened);
  assert.equal(opened.source, "chrome");

  await call("start_recording", { fps: 12 });
  await call("mark_step", { label: "Début" });
  await call("scroll", { dy: 400 });
  await call("click", { selector: "[data-testid=save]" });
  await call("wait_for", { ms: 800 });
  const rec = await call("stop_recording");
  assert.ok(rec.durationSec > 1);
  const video = await call("finalize", { kind: "video", project: "chrome tab", featureSlug: "contacts-tab", description: "Onglet Chrome attaché" });
  console.log("finalize video", video);
  assert.ok(fs.statSync(video.file).size > 1000);

  await call("screenshot", {});
  const shot = await call("finalize", { kind: "shot", project: "chrome tab", featureSlug: "contacts-tab", description: "Capture d'onglet" });
  console.log("finalize shot", shot.files);

  await call("close_target");
  const after = await (await fetch(`${cdpUrl}/json/list`)).json();
  assert.ok(after.filter((t) => t.type === "page").length >= 2, "detaching must not close the user's tabs");
  console.log(`\nOK — sorties dans ${outDir}`);
} finally {
  await client.close();
  const exited = new Promise((r) => chrome.once("exit", r));
  chrome.kill();
  await exited;
  try {
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // Chrome's helper processes can still write to the temp profile after it exits (Linux): leave it to the OS.
  }
}
