import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { toUrl } from "../browser.js";

test("toUrl keeps URLs and escapes local paths", () => {
  assert.equal(toUrl("http://localhost:3000/a#b"), "http://localhost:3000/a#b");
  // `#` would start a fragment and a space is not a valid URL character.
  const file = path.resolve("my demo", "#1", "index.html");
  const url = toUrl(file);
  assert.ok(url.startsWith("file:///") && url.includes("my%20demo/%231/"), url);
  assert.equal(new URL(url).hash, "");
  assert.equal(fileURLToPath(url), file);
});
