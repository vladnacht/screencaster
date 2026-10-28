import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { listAccounts } from "../secrets.js";

test("malformed accounts JSON never quotes the password in the error", () => {
  const secret = "hunter2-do-not-leak";
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "demo-secrets-"));
  fs.mkdirSync(path.join(project, ".screencaster"));
  fs.writeFileSync(path.join(project, ".screencaster", "accounts.json"), `{"admin": {"username": "a", "password": ${secret}}}`);

  const saved = process.env.SCREENCASTER_ACCOUNTS;
  try {
    delete process.env.SCREENCASTER_ACCOUNTS;
    assert.throws(() => listAccounts(project), (e: Error) => e.message.includes("accounts.json") && !e.message.includes(secret));
    process.env.SCREENCASTER_ACCOUNTS = `{"admin": {"password": ${secret}`;
    assert.throws(() => listAccounts(project), (e: Error) => e.message.includes("SCREENCASTER_ACCOUNTS") && !e.message.includes(secret));
  } finally {
    if (saved === undefined) delete process.env.SCREENCASTER_ACCOUNTS;
    else process.env.SCREENCASTER_ACCOUNTS = saved;
  }
});
