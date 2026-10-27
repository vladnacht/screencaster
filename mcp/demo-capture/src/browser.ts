import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { DEMO_INIT_SCRIPT } from "./overlay.js";

export type Source = "launch" | "chrome";

export interface Viewport {
  width: number;
  height: number;
}

export interface TargetInfo {
  targetId: string;
  title: string;
  url: string;
}

export const DEFAULT_CDP_URL = process.env.DEMO_AGENT_CDP_URL ?? "http://127.0.0.1:9222";

/** Tabs of a Chrome started with `--remote-debugging-port` (see scripts/chrome-debug). */
export async function listChromeTabs(cdpUrl = DEFAULT_CDP_URL): Promise<TargetInfo[]> {
  let res: Response;
  try {
    res = await fetch(`${cdpUrl}/json/list`);
  } catch {
    throw new Error(
      `Aucun Chrome joignable sur ${cdpUrl}. Lance d'abord scripts/chrome-debug.sh (ou .ps1 sous Windows), ` +
        "puis ouvre l'onglet à filmer dans cette fenêtre.",
    );
  }
  const all = (await res.json()) as { id: string; type: string; title: string; url: string }[];
  return all
    .filter((t) => t.type === "page" && !t.url.startsWith("devtools://") && !t.url.startsWith("chrome-extension://"))
    .map((t) => ({ targetId: t.id, title: t.title, url: t.url }));
}

/**
 * The one browser session the server owns. Actions, screenshots and the recorder all
 * go through `page`, so what is recorded is exactly what was driven.
 */
export class Session {
  private constructor(
    readonly source: Source,
    readonly browser: Browser,
    readonly context: BrowserContext,
    readonly page: Page,
    readonly viewport: Viewport,
  ) {}

  static async launch(opts: {
    url: string;
    viewport: Viewport;
    headless: boolean;
    storageState?: string;
    hideSelectors: string[];
  }): Promise<Session> {
    const launchOpts = { headless: opts.headless, slowMo: 40 };
    // Prefer the installed Chrome (nothing to download); fall back to Playwright's Chromium.
    let browser: Browser;
    try {
      browser = await chromium.launch({ ...launchOpts, channel: "chrome" });
    } catch {
      try {
        browser = await chromium.launch(launchOpts);
      } catch {
        throw new Error("Ni Google Chrome ni le Chromium de Playwright ne sont installés : lance `npx playwright install chromium`.");
      }
    }
    const context = await browser.newContext({
      viewport: opts.viewport,
      deviceScaleFactor: 1,
      storageState: opts.storageState,
    });
    await context.addInitScript(DEMO_INIT_SCRIPT, { hideSelectors: opts.hideSelectors });
    const page = await context.newPage();
    await page.goto(opts.url, { waitUntil: "load" });
    return new Session("launch", browser, context, page, opts.viewport);
  }

  static async attach(opts: { cdpUrl: string; targetId?: string; match?: string; hideSelectors: string[] }): Promise<Session> {
    const tabs = await listChromeTabs(opts.cdpUrl);
    let target: TargetInfo | undefined;
    if (opts.targetId) target = tabs.find((t) => t.targetId === opts.targetId);
    else if (opts.match) {
      const m = opts.match.toLowerCase();
      const hits = tabs.filter((t) => t.title.toLowerCase().includes(m) || t.url.toLowerCase().includes(m));
      if (hits.length > 1) {
        throw new Error(`Plusieurs onglets correspondent à "${opts.match}" : ${hits.map((h) => `${h.targetId} ${h.title}`).join(" | ")}`);
      }
      target = hits[0];
    }
    if (!target) throw new Error("Onglet introuvable. Appelle list_targets et passe un targetId.");

    const browser = await chromium.connectOverCDP(opts.cdpUrl);
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        const cdp = await context.newCDPSession(page);
        const { targetInfo } = (await cdp.send("Target.getTargetInfo")) as { targetInfo: { targetId: string } };
        await cdp.detach();
        if (targetInfo.targetId !== target.targetId) continue;
        // addInitScript only covers future navigations; inject into the current document too.
        await context.addInitScript(DEMO_INIT_SCRIPT, { hideSelectors: opts.hideSelectors });
        await page.evaluate(DEMO_INIT_SCRIPT, { hideSelectors: opts.hideSelectors });
        const size = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
        return new Session("chrome", browser, context, page, size);
      }
    }
    await browser.close();
    throw new Error(`Onglet ${target.targetId} non attachable.`);
  }

  async close(): Promise<void> {
    // On an attached Chrome this only disconnects: the user's tabs stay open.
    if (this.source === "launch") await this.context.close().catch(() => {});
    await this.browser.close().catch(() => {});
  }
}
