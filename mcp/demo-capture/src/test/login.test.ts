import assert from "node:assert/strict";
import { test } from "node:test";
import { loginAllowed } from "../secrets.js";

test("credentials are typed only on a local app or a listed origin", () => {
  const acc = { username: "a", password: "p" };
  for (const url of ["http://localhost:3000/login", "http://127.0.0.1:8000", "http://app.test/", "https://shop.localhost/", "file:///tmp/a.html"]) {
    assert.ok(loginAllowed(url, acc, ""), url);
  }
  assert.ok(!loginAllowed("https://evil.example/login", acc, ""));
  assert.ok(!loginAllowed("https://staging.acme.com/login", acc, ""));
  assert.ok(loginAllowed("https://staging.acme.com/login", { ...acc, origins: ["https://staging.acme.com"] }, ""));
  assert.ok(loginAllowed("https://staging.acme.com/login", acc, "https://x.io, https://staging.acme.com"));
  assert.ok(!loginAllowed("https://staging.acme.com.evil.example/", { ...acc, origins: ["https://staging.acme.com"] }, ""));
});
