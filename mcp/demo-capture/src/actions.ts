import type { Locator, Page } from "playwright";
import type { CardContent } from "./overlay.js";

/** Pause after each action so a viewer can follow (SCREENCASTER_STEP_PAUSE_MS, default 600). */
const STEP_PAUSE_MS = Number(process.env.SCREENCASTER_STEP_PAUSE_MS ?? 600);

export interface TargetRef {
  /** Any Playwright selector: CSS, `text=…`, `role=button[name="Export"]`, `[data-testid=…]`. */
  selector?: string;
  /** Visible text, matched loosely. */
  text?: string;
  /** ARIA role + accessible name, e.g. role "button", name "Exporter". */
  role?: string;
  name?: string;
}

export function locate(page: Page, ref: TargetRef): Locator {
  if (ref.role) return page.getByRole(ref.role as Parameters<Page["getByRole"]>[0], ref.name ? { name: ref.name } : {}).first();
  if (ref.selector) return page.locator(ref.selector).first();
  if (ref.text) return page.getByText(ref.text).first();
  throw new Error("Indique selector, text ou role.");
}

export const settle = (page: Page, ms = STEP_PAUSE_MS) => page.waitForTimeout(ms);

/** On-screen box of the element: scrolled into view, and the zoom panned onto it if needed. */
async function reveal(page: Page, loc: Locator) {
  await loc.scrollIntoViewIfNeeded();
  const box = await loc.boundingBox();
  if (box && (await overlay(page, "reveal", box))) return loc.boundingBox();
  return box;
}

/** Glide the (visible) cursor to the element centre, so the viewer sees where we act. */
async function glideTo(page: Page, loc: Locator): Promise<void> {
  const box = await reveal(page, loc);
  if (!box) return;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 18 });
}

export async function click(page: Page, ref: TargetRef): Promise<void> {
  const loc = locate(page, ref);
  await loc.waitFor({ state: "visible", timeout: 10_000 });
  await glideTo(page, loc);
  await loc.click();
  await settle(page);
}

export async function hover(page: Page, ref: TargetRef): Promise<void> {
  const loc = locate(page, ref);
  await loc.waitFor({ state: "visible", timeout: 10_000 });
  await glideTo(page, loc);
  await settle(page);
}

export async function typeInto(page: Page, ref: TargetRef, text: string, opts: { clear?: boolean; pressEnter?: boolean }): Promise<void> {
  const loc = locate(page, ref);
  await loc.waitFor({ state: "visible", timeout: 10_000 });
  await glideTo(page, loc);
  await loc.click();
  if (opts.clear !== false) await loc.fill("");
  // Typed character by character so it reads as typing in the video.
  await loc.pressSequentially(text, { delay: 45 });
  if (opts.pressEnter) await loc.press("Enter");
  await settle(page);
}

export async function scroll(page: Page, ref: TargetRef | undefined, dy: number): Promise<void> {
  if (ref && (ref.selector || ref.text || ref.role)) {
    await locate(page, ref).scrollIntoViewIfNeeded();
  } else {
    // Several small wheel steps look like a human scroll instead of a jump.
    const steps = 8;
    for (let i = 0; i < steps; i++) {
      await page.mouse.wheel(0, dy / steps);
      await page.waitForTimeout(30);
    }
  }
  await settle(page);
}

export async function caption(page: Page, text: string | null): Promise<void> {
  await page
    .evaluate((t) => (window as unknown as { __demo?: { caption(t: string | null): void } }).__demo?.caption(t), text)
    .catch(() => {});
}

/** Calls a `window.__demo` overlay method in the page (a no-op where the overlay is missing). */
function overlay(page: Page, method: string, ...args: unknown[]): Promise<unknown> {
  return page.evaluate(
    ({ method, args }) => (window as unknown as { __demo?: Record<string, (...a: unknown[]) => unknown> }).__demo?.[method]?.(...args),
    { method, args },
  );
}

/** Full-screen explainer page, faded in, held `ms`, faded out. Recorded like the rest of the page. */
export async function card(page: Page, content: CardContent, ms = 4000): Promise<void> {
  await overlay(page, "card", content, ms);
}

export interface HighlightOptions {
  label?: string;
  color?: string;
  /** Hold before acting. */
  ms?: number;
}

/** Visible box of the element, scrolled into view first, read right before drawing. */
async function visibleBox(page: Page, ref: TargetRef) {
  const loc = locate(page, ref);
  await loc.waitFor({ state: "visible", timeout: 10_000 });
  const box = await reveal(page, loc);
  if (!box) throw new Error("Élément sans boîte visible.");
  return box;
}

/** Frames the element with a rectangle (and an optional label) until `unhighlight`. */
export async function highlight(page: Page, ref: TargetRef, o: HighlightOptions = {}): Promise<void> {
  await overlay(page, "highlight", await visibleBox(page, ref), { label: o.label, color: o.color });
}

export async function unhighlight(page: Page): Promise<void> {
  await overlay(page, "unhighlight");
}

/** Frames the element, holds `o.ms` (default 900), runs the action, then removes the frame 400 ms later. */
export async function withHighlight(page: Page, ref: TargetRef, o: HighlightOptions, action: () => Promise<void>): Promise<void> {
  await highlight(page, ref, o);
  try {
    await page.waitForTimeout(o.ms ?? 900);
    await action();
    await page.waitForTimeout(400);
  } finally {
    await unhighlight(page).catch(() => {});
  }
}

/** Zooms the page (CSS transform on body) so the element is magnified toward the centre; stays zoomed. */
export async function zoom(page: Page, ref: TargetRef, scale = 1.8, ms = 600): Promise<void> {
  await overlay(page, "zoom", await visibleBox(page, ref), scale, ms);
}

export async function unzoom(page: Page, ms = 600): Promise<void> {
  await overlay(page, "unzoom", ms);
}

/** Compact list of what can be acted on, so the operator can pick selectors without guessing. */
export async function snapshot(page: Page, limit = 80): Promise<string> {
  const items = await page.evaluate((max) => {
    const out: string[] = [];
    const sel = "a[href], button, input, select, textarea, [role=button], [role=link], [role=tab], [role=menuitem], [data-testid], h1, h2, h3";
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const tag = el.tagName.toLowerCase();
      const role = el.getAttribute("role") ?? "";
      const label =
        el.getAttribute("aria-label") ||
        (el as HTMLInputElement).placeholder ||
        el.innerText?.trim().replace(/\s+/g, " ").slice(0, 60) ||
        (el as HTMLInputElement).name ||
        "";
      const testid = el.getAttribute("data-testid");
      const type = (el as HTMLInputElement).type && tag === "input" ? `[type=${(el as HTMLInputElement).type}]` : "";
      const inView = r.top < window.innerHeight && r.bottom > 0 ? "" : " (hors écran)";
      out.push(`${tag}${type}${role ? ` role=${role}` : ""}${testid ? ` data-testid=${testid}` : ""} "${label}"${inView}`);
      if (out.length >= max) break;
    }
    return out;
  }, limit);
  return [`URL: ${page.url()}`, `Titre: ${await page.title()}`, ...items].join("\n");
}
