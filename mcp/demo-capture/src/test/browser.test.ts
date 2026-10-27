import assert from "node:assert/strict";
import { test } from "node:test";
import { toUrl } from "../browser.js";

test("toUrl keeps URLs and escapes local paths", () => {
  assert.equal(toUrl("http://localhost:3000/a#b"), "http://localhost:3000/a#b");
  // `#` would start a fragment and a space is not a valid URL character.
  const url = toUrl("/tmp/my demo/#1/index.html");
  assert.equal(url, "file:///tmp/my%20demo/%231/index.html");
  assert.equal(new URL(url).hash, "");
});
