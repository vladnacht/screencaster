#!/usr/bin/env node
// One-time setup of the demo-capture MCP server: install its dependencies (including a
// bundled ffmpeg), compile it, and make sure a browser is available.
// Usage: node scripts/setup.mjs
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverDir = path.join(root, "mcp", "demo-capture");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: serverDir, stdio: ["ignore", process.stderr, process.stderr], shell: process.platform === "win32" });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} a échoué (${r.status})`);
};

export function setup() {
  console.error("[demo-agent] npm install…");
  run(npm, ["install", "--no-audit", "--no-fund"]);
  console.error("[demo-agent] build…");
  run(npm, ["run", "build"]);

  // Google Chrome is used when installed; otherwise fetch Playwright's Chromium.
  const hasChrome =
    (process.platform === "darwin" && fs.existsSync("/Applications/Google Chrome.app")) ||
    (process.platform === "win32" &&
      [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA]
        .filter(Boolean)
        .some((p) => fs.existsSync(path.join(p, "Google", "Chrome", "Application", "chrome.exe")))) ||
    (process.platform === "linux" && spawnSync("sh", ["-c", "command -v google-chrome || command -v google-chrome-stable"]).status === 0);
  if (!hasChrome) {
    console.error("[demo-agent] Chrome absent : installation du Chromium de Playwright…");
    run(process.platform === "win32" ? "npx.cmd" : "npx", ["playwright", "install", "chromium"]);
  }
  console.error("[demo-agent] prêt.");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    setup();
    console.log("Installation terminée. Relance Claude Code pour charger le serveur demo-capture.");
  } catch (e) {
    console.error(String(e instanceof Error ? e.message : e));
    process.exit(1);
  }
}
