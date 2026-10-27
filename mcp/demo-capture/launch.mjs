#!/usr/bin/env node
// Entry point referenced by the plugin's .mcp.json. On a fresh machine the server is not
// installed yet: install and build it first (once, ~1 min), then start it.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const server = path.join(here, "dist", "server.js");

if (!fs.existsSync(server) || !fs.existsSync(path.join(here, "node_modules", "@modelcontextprotocol"))) {
  const { setup } = await import(pathToFileURL(path.join(here, "..", "..", "scripts", "setup.mjs")).href);
  setup();
}
await import(pathToFileURL(server).href);
