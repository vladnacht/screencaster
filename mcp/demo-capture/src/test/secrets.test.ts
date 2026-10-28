import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { listAccounts, resolveAccount } from "../secrets.js";

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

test("envFile accounts come only from a .env file inside the project", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "demo-envfile-"));
  const project = path.join(base, "app");
  const evil = path.join(base, "app-evil");
  for (const d of [project, evil, path.join(project, ".aws")]) fs.mkdirSync(d, { recursive: true });
  const env = "U=ada@example.com\nP=test-pass\n";
  fs.writeFileSync(path.join(project, ".env.example"), env);
  fs.writeFileSync(path.join(evil, ".env"), env);
  fs.writeFileSync(path.join(project, ".aws", "credentials"), "U = AKIA\nP = real-secret\n");
  fs.symlinkSync(path.join(evil, ".env"), path.join(project, ".env.link"));
  const ref = (envFile: string) => ({ envFile, userKey: "U", passKey: "P" });

  assert.equal(resolveAccount(project, ref(".env.example")).password, "test-pass");
  assert.throws(() => resolveAccount(project, ref(".aws/credentials")), /fichier \.env/);
  assert.throws(() => resolveAccount(project, ref("../app-evil/.env")), /rester dans le projet/);
  assert.throws(() => resolveAccount(project, ref(".env.link")), /rester dans le projet/);
});
