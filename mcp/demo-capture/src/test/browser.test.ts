import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import * as act from "../actions.js";
import { Session, toUrl } from "../browser.js";
import { DEMO_INIT_SCRIPT } from "../overlay.js";
import { runStep } from "../storyboard.js";

test("toUrl keeps URLs and escapes local paths", () => {
  assert.equal(toUrl("http://localhost:3000/a#b"), "http://localhost:3000/a#b");
  // `#` would start a fragment and a space is not a valid URL character.
  const file = path.resolve("my demo", "#1", "index.html");
  const url = toUrl(file);
  assert.ok(url.startsWith("file:///") && url.includes("my%20demo/%231/"), url);
  assert.equal(new URL(url).hash, "");
  assert.equal(fileURLToPath(url), file);
});

// ---------- in-page overlays: cards, highlights, zoom ----------

const W = 800;
const H = 600;
let session: Session;
const ctx = { projectDir: process.cwd(), shot: async () => "" };

before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "demo-overlay-"));
  const file = path.join(dir, "page.html");
  fs.writeFileSync(file, `<title>t</title><style>body{margin:0;height:${H}px}</style>
    <button id="go" style="position:absolute;left:150px;top:120px;width:120px;height:40px"
      onclick="this.dataset.clicks=String(Number(this.dataset.clicks||0)+1)">Go</button>
    <input id="name" style="position:absolute;left:500px;top:400px;width:200px">`);
  session = await Session.launch({ url: toUrl(file), viewport: { width: W, height: H }, headless: true, hideSelectors: [] });
});
after(() => session?.close());

const rect = (sel: string) =>
  session.page.evaluate((s) => {
    const r = document.querySelector(s)!.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }, sel);
const centreDist = (r: { x: number; y: number; width: number; height: number }) =>
  Math.hypot(r.x + r.width / 2 - W / 2, r.y + r.height / 2 - H / 2);

test("card covers the page with its title while shown, hides caption and cursor, then goes away", async () => {
  const p = session.page;
  await act.caption(p, "Bandeau");
  const running = runStep(p, { action: "card", title: "Partie 2", kicker: "Partie 2 · RBCG", bullets: ["Un", "Deux"], ms: 800 }, ctx);
  await p.locator("#__demo-card").waitFor({ state: "visible" });
  assert.match(await p.locator("#__demo-card").innerText(), /Partie 2[\s\S]*Un[\s\S]*Deux/);
  const hidden = await p.evaluate(() =>
    ["#__demo-caption", "#__demo-cursor"].map((s) => getComputedStyle(document.querySelector(s)!).visibility));
  assert.deepEqual(hidden, ["hidden", "hidden"]);
  await running;
  assert.equal(await p.locator("#__demo-card").count(), 0);
  assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector("#__demo-caption")!).visibility), "visible");
  await act.caption(p, null);
});

test("highlight frames the target's bounding box, then is removed", async () => {
  const p = session.page;
  await act.highlight(p, { selector: "#go" }, { label: "Bouton" });
  await p.waitForTimeout(350); // entry animation
  const target = await rect("#go");
  const hl = await rect(".__demo-hl");
  for (const [inner, outer] of [[target.x, hl.x], [target.y, hl.y]]) assert.ok(outer <= inner - 4 && outer >= inner - 14, `${outer} vs ${inner}`);
  assert.ok(hl.x + hl.width >= target.x + target.width + 4 && hl.x + hl.width <= target.x + target.width + 14);
  assert.ok(hl.y + hl.height >= target.y + target.height + 4 && hl.y + hl.height <= target.y + target.height + 14);
  assert.match(await p.locator(".__demo-hl").innerText(), /Bouton/);
  await act.unhighlight(p);
  assert.equal(await p.locator(".__demo-hl").count(), 0);

  await runStep(p, { action: "click", selector: "#go", highlight: { ms: 100 } }, ctx);
  assert.equal(await p.locator(".__demo-hl").count(), 0);
});

test("zoom magnifies toward the centre, clicks still land, unzoom returns to 1x, overlays stay outside body", async () => {
  const p = session.page;
  const before = await rect("#go");
  await runStep(p, { action: "zoom", selector: "#go", scale: 2, ms: 200 }, ctx);
  const zoomed = await rect("#go");
  assert.ok(Math.abs(zoomed.width - 2 * before.width) < 2, `width ${zoomed.width}`);
  assert.ok(centreDist(zoomed) < centreDist(before), "target moves toward the viewport centre");
  // Clamped: the page's top-left corner never leaves the viewport's top-left.
  const body = await rect("body");
  assert.ok(body.x <= 0.5 && body.y <= 0.5 && body.x + body.width >= W - 0.5, JSON.stringify(body));

  const outside = await p.evaluate(() =>
    ["#__demo-cursor", "#__demo-caption"].every((s) => !document.body.contains(document.querySelector(s))));
  assert.ok(outside);

  const clicks = Number((await p.locator("#go").getAttribute("data-clicks")) ?? 0);
  await runStep(p, { action: "click", selector: "#go" }, ctx);
  assert.equal(Number(await p.locator("#go").getAttribute("data-clicks")), clicks + 1);
  await runStep(p, { action: "type", selector: "#name", value: "Ada" }, ctx);
  assert.equal(await p.locator("#name").inputValue(), "Ada");

  // Zoomed on the bottom-right field, the button sits above-left of the viewport, out of scroll reach:
  // acting on it pans the zoom to bring it on screen.
  await runStep(p, { action: "zoom", selector: "#name", scale: 2, ms: 200 }, ctx);
  assert.ok((await rect("#go")).x + before.width * 2 <= 0, "button off screen to the left");
  await runStep(p, { action: "click", selector: "#go", highlight: { ms: 50 } }, ctx);
  assert.equal(Number(await p.locator("#go").getAttribute("data-clicks")), clicks + 2);
  assert.ok(Math.abs((await rect("#go")).width - 2 * before.width) < 2, "still zoomed");

  await runStep(p, { action: "unzoom", ms: 200 }, ctx);
  assert.equal(await p.evaluate(() => getComputedStyle(document.body).transform), "none");
  assert.deepEqual(await rect("#go"), before);
});

test("zoom stays anchored after a scroll, skips panning on a large target, and navigate resets it", async () => {
  const p = session.page;
  const transform = () => p.evaluate(() => document.body.style.transform);
  await p.evaluate(() => { document.body.style.height = "3000px"; });
  try {
    await runStep(p, { action: "zoom", selector: "#name", scale: 2, ms: 100 }, ctx);
    assert.ok(centreDist(await rect("#name")) < 3, "centred on first zoom");
    await p.evaluate(() => window.scrollBy(0, 200));
    await runStep(p, { action: "zoom", selector: "#name", scale: 2, ms: 100 }, ctx);
    const r = await rect("#name");
    assert.ok(centreDist(r) < 3, `re-zoom after scroll lands centred, got ${JSON.stringify(r)}`);

    // A target larger than the viewport is never "inside" it: no pan before acting.
    await p.evaluate(() => {
      const big = document.createElement("div");
      big.id = "big";
      big.style.cssText = "position:absolute;left:0;top:0;width:780px;height:3000px";
      document.body.prepend(big);
    });
    const zoomed = await transform();
    await act.highlight(p, { selector: "#big" });
    assert.equal(await transform(), zoomed, "no pan on a target larger than the viewport");
    await act.unhighlight(p);

    await runStep(p, { action: "navigate", url: "#reset" }, ctx);
    assert.equal(await p.evaluate(() => getComputedStyle(document.body).transform), "none");
  } finally {
    await act.unzoom(p, 0);
    await p.evaluate(() => { document.getElementById("big")?.remove(); document.body.style.removeProperty("height"); window.scrollTo(0, 0); });
  }
});

test("a stale overlay from an older version is refused, and re-injecting the script replaces it", async () => {
  const p = session.page;
  await p.evaluate(() => { (window as unknown as { __demo: unknown }).__demo = { caption() {} }; });
  await assert.rejects(act.card(p, { title: "x" }, 0), /obsolète/);
  await p.evaluate(DEMO_INIT_SCRIPT, { hideSelectors: [] });
  await act.card(p, { title: "x" }, 0);
  assert.equal(await p.locator("#__demo-cursor").count(), 1);
  assert.equal(await p.locator("#__demo-caption").count(), 1);
});
