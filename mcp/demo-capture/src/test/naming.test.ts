import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { buildBaseName, outputDir, outputRoot, slugify, uniquePath } from "../naming.js";
import { parseDotenv } from "../secrets.js";

const date = new Date(2026, 9, 27, 14, 32);

test("slugify strips accents, symbols and length", () => {
  assert.equal(slugify("Créer un Contact !"), "creer-un-contact");
  assert.equal(slugify("  Export CSV / Étape 2  "), "export-csv-etape-2");
  assert.equal(slugify("###"), "demo");
  assert.ok(slugify("a".repeat(100)).length <= 48);
});

test("buildBaseName is only the explicit title, numbered for a set of screenshots", () => {
  assert.equal(buildBaseName("Espace pro : ajouter un client et voir la confirmation"), "espace-pro-ajouter-un-client-et-voir-la-confirmation");
  assert.equal(buildBaseName("liste des projets filtrée", 2), "liste-des-projets-filtree-2");
  // Long titles are cut to 80 characters, without a trailing hyphen.
  const long = buildBaseName("tableau de bord ".repeat(10));
  assert.ok(long.length <= 80 && !long.endsWith("-"), long);
});

test("output root is <home>/Documents/Demos on every platform, overridable", () => {
  for (const home of ["/Users/ada", "/home/ada", "C:\\Users\\ada"]) {
    assert.equal(outputRoot(undefined, home), path.join(home, "Documents", "Demos"));
  }
  assert.equal(outputRoot("/tmp/out", "/Users/ada"), path.resolve("/tmp/out"));
  assert.equal(outputDir("Mon Blog", "video", date, "/r"), path.join("/r", "mon-blog", "2026-10-27", "videos"));
  assert.equal(outputDir("Mon Blog", "shot", date, "/r"), path.join("/r", "mon-blog", "2026-10-27", "images"));
});

test("uniquePath appends _2, _3 on collision", () => {
  const taken = new Set([path.join("/d", "a.mp4"), path.join("/d", "a_2.mp4")]);
  assert.equal(uniquePath("/d", "a", "mp4", (p) => taken.has(p)), path.join("/d", "a_3.mp4"));
  assert.equal(uniquePath("/d", "b", ".png", () => false), path.join("/d", "b.png"));
});

test("parseDotenv handles quotes, export and comments", () => {
  const env = parseDotenv('export A=1\nB="two words"\nC=three # comment\n# D=no\nE=\'x#y\'');
  assert.deepEqual(env, { A: "1", B: "two words", C: "three", E: "x#y" });
});
