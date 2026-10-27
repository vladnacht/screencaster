import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { runFfmpeg } from "../encode.js";

test("two shot batches finalized in the same minute keep their own meta.json", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "demo-finalize-"));
  const raw = path.join(dir, "raw.png");
  await runFfmpeg(["-f", "lavfi", "-i", "color=c=red:s=200x100", "-frames:v", "1", raw]);

  const server = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "server.js");
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(new StdioClientTransport({
    command: process.execPath, args: [server], env: { ...process.env, DEMO_AGENT_OUTPUT_DIR: path.join(dir, "out") } as Record<string, string>,
  }));
  try {
    const finalize = async (description: string) => {
      const res = await client.callTool({ name: "finalize", arguments: { kind: "shot", project: "p", featureSlug: "f", description, rawFiles: [raw] } });
      const text = (res.content as { text: string }[])[0].text;
      assert.ok(!res.isError, text);
      return JSON.parse(text) as { meta: string; files: { file: string }[] };
    };
    const a = await finalize("first");
    const b = await finalize("second");
    assert.notEqual(a.meta, b.meta);
    for (const [r, description] of [[a, "first"], [b, "second"]] as const) {
      const meta = JSON.parse(fs.readFileSync(r.meta, "utf8"));
      assert.equal(meta.description, description);
      assert.equal(meta.files[0].file, path.basename(r.files[0].file));
    }
  } finally {
    await client.close();
  }
});
