import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const MCP = "mcp__plugin_screencaster_demo-capture__";

function tools(agent: string): string[] {
  const m = /^tools:\s*(.+)$/m.exec(fs.readFileSync(path.join(root, "agents", `${agent}.md`), "utf8"));
  assert.ok(m, `${agent} must declare its tools: without the field it inherits every tool, shell included`);
  return m[1].split(",").map((t) => t.trim());
}

test("subagents that read untrusted pages get no shell, no writes and no web", () => {
  const serverTools = [...fs.readFileSync(path.join(root, "mcp", "demo-capture", "src", "server.ts"), "utf8").matchAll(/registerTool\(\s*"(\w+)"/g)].map((m) => m[1]);
  for (const agent of ["target-resolver", "demo-planner", "capture-operator", "media-reviewer"]) {
    for (const t of tools(agent)) {
      assert.ok(!/^(Bash|Write|Edit|NotebookEdit|WebFetch|WebSearch|Agent|\*)/.test(t), `${agent} must not get ${t}`);
      if (t.startsWith(MCP) && !t.endsWith("*")) assert.ok(serverTools.includes(t.slice(MCP.length)), `${agent}: unknown tool ${t}`);
    }
  }
  assert.deepEqual(tools("capture-operator"), [`${MCP}*`]);
  assert.deepEqual(tools("media-reviewer"), ["Read", `${MCP}extract_frames`]);
});
