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

test("buildBaseName follows date_time_project_feature_kind[_n]_WxH", () => {
  assert.equal(
    buildBaseName({ project: "Acme Shop", featureSlug: "export-csv", kind: "video", width: 1440, height: 900, ext: "mp4", date }),
    "2026-10-27_1432_acme-shop_export-csv_video_1440x900",
  );
  assert.equal(
    buildBaseName({ project: "acme-shop", featureSlug: "x", kind: "shot", width: 390, height: 844, ext: "png", index: 2, date }),
    "2026-10-27_1432_acme-shop_x_shot_2_390x844",
  );
});

test("output root is <home>/Documents/Demos on every platform, overridable", () => {
  for (const home of ["/Users/ada", "/home/ada", "C:\\Users\\ada"]) {
    assert.equal(outputRoot({}, home), path.join(home, "Documents", "Demos"));
  }
  assert.equal(outputRoot({ SCREENCASTER_OUTPUT_DIR: "/tmp/out" }, "/Users/ada"), path.resolve("/tmp/out"));
  assert.equal(outputDir("Mon Blog", date, "/r"), path.join("/r", "mon-blog", "2026-10-27"));
});

test("uniquePath appends _2, _3 on collision", () => {
  const taken = new Set(["/d/a.mp4", "/d/a_2.mp4"]);
  assert.equal(uniquePath("/d", "a", "mp4", (p) => taken.has(p)), path.join("/d", "a_3.mp4"));
  assert.equal(uniquePath("/d", "b", ".png", () => false), path.join("/d", "b.png"));
});

test("parseDotenv handles quotes, export and comments", () => {
  const env = parseDotenv('export A=1\nB="two words"\nC=three # comment\n# D=no\nE=\'x#y\'');
  assert.deepEqual(env, { A: "1", B: "two words", C: "three", E: "x#y" });
});
