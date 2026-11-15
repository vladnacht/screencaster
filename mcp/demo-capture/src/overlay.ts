/** Dev overlays that should never appear in a demo. */
export const DEFAULT_HIDE_SELECTORS = [
  "nextjs-portal",
  "[data-nextjs-toast]",
  "[data-nextjs-dev-tools-button]",
  "#__next-build-watcher",
  "#__next-prerender-indicator",
  "vite-error-overlay",
  "#vite-error-overlay",
  ".tsqd-parent-container",
  ".ReactQueryDevtools",
  "#webpack-dev-server-client-overlay",
  "astro-dev-toolbar",
  "#_nuxt-devtools-container",
];

export interface CardContent {
  title: string;
  body?: string;
  bullets?: string[];
  kicker?: string;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Runs in the page (as an init script and on attach). Adds a visible fake cursor with
 * a click ripple, a caption bar, explainer cards, highlight frames and a zoom, all driven
 * through `window.__demo`, and hides dev overlays. Must stay self-contained: Playwright
 * serialises it. Every overlay hangs off `documentElement`, outside the zoomed `body`.
 */
export function DEMO_INIT_SCRIPT({ hideSelectors }: { hideSelectors: string[] }): void {
  // Bumped when `window.__demo` gains methods: a tab still holding an older overlay
  // (attached Chrome, injected by a previous version) gets the new one instead of keeping it.
  const VERSION = 2;
  const w = window as unknown as { __demo?: { version?: number; [method: string]: unknown } };
  if (w.__demo?.version === VERSION) return;

  const install = () => {
    for (const id of ["__demo-cursor", "__demo-caption", "__demo-card"]) document.getElementById(id)?.remove();
    const style = document.createElement("style");
    style.textContent = `
      ${hideSelectors.join(",")} { display: none !important; }
      #__demo-cursor { position: fixed; top: 0; left: 0; width: 22px; height: 22px; z-index: 2147483647;
        pointer-events: none; transform: translate(-100px, -100px); transition: transform 40ms linear; }
      #__demo-cursor svg { filter: drop-shadow(0 1px 2px rgba(0,0,0,.45)); }
      .__demo-ripple { position: fixed; width: 36px; height: 36px; margin: -18px 0 0 -18px; border-radius: 50%;
        border: 3px solid rgba(255, 92, 53, .9); pointer-events: none; z-index: 2147483646;
        animation: __demo-ripple 450ms ease-out forwards; }
      @keyframes __demo-ripple { from { transform: scale(.3); opacity: 1 } to { transform: scale(1.4); opacity: 0 } }
      #__demo-caption { position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%); z-index: 2147483647;
        max-width: 80vw; padding: 10px 18px; border-radius: 10px; background: rgba(17, 17, 17, .85); color: #fff;
        font: 600 18px/1.35 -apple-system, "Segoe UI", Roboto, sans-serif; pointer-events: none;
        opacity: 0; transition: opacity 200ms ease; }
      #__demo-caption.on { opacity: 1; }
      html.__demo-card-on #__demo-caption, html.__demo-card-on #__demo-cursor { visibility: hidden; }
      #__demo-card { position: fixed; inset: 0; z-index: 2147483647; display: flex; align-items: center; justify-content: center;
        background: #fff; color: #141414; pointer-events: none; opacity: 0; transition: opacity 250ms ease;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; text-align: left; }
      #__demo-card.on { opacity: 1; }
      #__demo-card .__demo-col { box-sizing: border-box; width: 100%; max-width: 880px; padding: 0 48px; }
      #__demo-card .__demo-kicker { margin: 0 0 16px; color: #ff5c35; font-size: 16px; font-weight: 700; line-height: 1.3;
        letter-spacing: .08em; text-transform: uppercase; }
      #__demo-card .__demo-title { margin: 0 0 24px; font-size: 52px; font-weight: 800; line-height: 1.12; letter-spacing: -.02em; }
      #__demo-card .__demo-body { margin: 0 0 20px; color: #3a3a3a; font-size: 24px; line-height: 1.5; white-space: pre-line; }
      #__demo-card .__demo-bullets { margin: 0; padding: 0; list-style: none; }
      #__demo-card .__demo-bullets > div { position: relative; margin: 12px 0; padding-left: 32px; color: #3a3a3a; font-size: 24px; line-height: 1.45; }
      #__demo-card .__demo-bullets > div::before { content: ""; position: absolute; left: 0; top: .5em; width: 12px; height: 12px;
        border-radius: 3px; background: #ff5c35; }
      .__demo-hl { position: fixed; z-index: 2147483646; box-sizing: border-box; pointer-events: none; border: 3px solid var(--hl);
        border-radius: 10px; box-shadow: 0 0 0 3px rgba(255,255,255,.55), 0 0 22px 4px var(--hl);
        animation: __demo-hl 250ms ease-out; transition: opacity 200ms ease; }
      .__demo-hl.off { opacity: 0; }
      .__demo-hl > span { position: absolute; left: -3px; bottom: 100%; margin-bottom: 6px; padding: 5px 9px; border-radius: 6px;
        background: var(--hl); color: #fff; white-space: nowrap; font: 600 13px/1 -apple-system, "Segoe UI", Roboto, sans-serif; }
      @keyframes __demo-hl { from { opacity: 0; transform: scale(1.12) } to { opacity: 1; transform: scale(1) } }
    `;
    document.documentElement.appendChild(style);

    const cursor = document.createElement("div");
    cursor.id = "__demo-cursor";
    cursor.innerHTML =
      '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 2l16 9.5-7 1.5-3.5 7z" fill="#111" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    const caption = document.createElement("div");
    caption.id = "__demo-caption";
    document.documentElement.append(cursor, caption);

    window.addEventListener("mousemove", (e) => {
      cursor.style.transform = `translate(${e.clientX - 3}px, ${e.clientY - 2}px)`;
    }, true);
    window.addEventListener("mousedown", (e) => {
      const r = document.createElement("div");
      r.className = "__demo-ripple";
      r.style.left = `${e.clientX}px`;
      r.style.top = `${e.clientY}px`;
      document.documentElement.appendChild(r);
      setTimeout(() => r.remove(), 500);
    }, true);

    const root = document.documentElement;
    const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    const add = (parent: HTMLElement, cls: string, text: string) => {
      const el = document.createElement("div");
      el.className = cls;
      el.textContent = text;
      parent.append(el);
      return el;
    };
    // Current zoom of body (transform-origin 0 0): scale s, translate t.
    let zoom = { s: 1, tx: 0, ty: 0 };

    // Read live, since any scroll moves body: its zoomed top-left corner r sits at O + t, O being
    // the unzoomed one, and an on-screen point maps back to O + (point - r) / s.
    const bodyOrigin = () => {
      const r = document.body.getBoundingClientRect();
      return { left: r.left, top: r.top, ox: r.left - zoom.tx, oy: r.top - zoom.ty };
    };

    /** Zooms to scale s so that an unzoomed viewport point p shows at a + s * p. */
    const setZoom = async (s: number, ax: number, ay: number, ms: number) => {
      const body = document.body;
      const { ox, oy } = bodyOrigin();
      const tx = ax + (s - 1) * ox;
      const ty = ay + (s - 1) * oy;
      body.style.transformOrigin = "0 0";
      body.style.transition = `transform ${ms}ms ease-in-out`;
      body.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
      zoom = { s, tx, ty };
      await wait(ms);
      // The transition may still be a frame short: cancelling it snaps to the final transform.
      body.style.transition = "none";
    };

    w.__demo = {
      version: VERSION,

      caption(text: string | null) {
        caption.textContent = text ?? "";
        caption.classList.toggle("on", !!text);
      },

      async card(c: CardContent, ms: number) {
        document.getElementById("__demo-card")?.remove();
        const card = document.createElement("div");
        card.id = "__demo-card";
        const col = add(card, "__demo-col", "");
        if (c.kicker) add(col, "__demo-kicker", c.kicker);
        add(col, "__demo-title", c.title);
        if (c.body) add(col, "__demo-body", c.body);
        if (c.bullets?.length) {
          const list = add(col, "__demo-bullets", "");
          for (const b of c.bullets) add(list, "", b);
        }
        root.append(card);
        root.classList.add("__demo-card-on");
        void card.offsetWidth; // commit opacity 0 so the fade-in runs
        card.classList.add("on");
        await wait(250 + ms);
        card.classList.remove("on");
        await wait(250);
        card.remove();
        root.classList.remove("__demo-card-on");
      },

      highlight(box: Box, o: { label?: string; color?: string }) {
        const pad = 6;
        const hl = document.createElement("div");
        hl.className = "__demo-hl";
        hl.style.setProperty("--hl", o.color || "#ff5c35");
        hl.style.left = `${box.x - pad}px`;
        hl.style.top = `${box.y - pad}px`;
        hl.style.width = `${box.width + 2 * pad}px`;
        hl.style.height = `${box.height + 2 * pad}px`;
        if (o.label) {
          const tag = document.createElement("span");
          tag.textContent = o.label;
          hl.append(tag);
        }
        root.append(hl);
      },

      async unhighlight() {
        const all = Array.from(document.querySelectorAll(".__demo-hl"));
        for (const hl of all) hl.classList.add("off");
        await wait(200);
        for (const hl of all) hl.remove();
      },

      /** Magnifies the page around `box` (on-screen coordinates) and stays zoomed. */
      zoom(box: Box, scale: number, ms: number) {
        const s = Math.min(3, Math.max(1, scale));
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        // Target centre in unzoomed coordinates, sent toward the viewport centre.
        const o = bodyOrigin();
        const cx = o.ox + (box.x + box.width / 2 - o.left) / zoom.s;
        const cy = o.oy + (box.y + box.height / 2 - o.top) / zoom.s;
        // Clamped so the zoomed page still covers the whole viewport.
        const clamp = (v: number, size: number) => Math.min(0, Math.max(size * (1 - s), v));
        return setZoom(s, clamp(vw / 2 - s * cx, vw), clamp(vh / 2 - s * cy, vh), ms);
      },

      /**
       * While zoomed, an element pushed above or left of the viewport cannot be scrolled to:
       * pan the zoom onto it. Returns true when the page moved.
       */
      async reveal(box: Box) {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const inside = box.x >= 0 && box.y >= 0 && box.x + box.width <= vw && box.y + box.height <= vh;
        // A target larger than the viewport never fits: panning before each action would only jitter.
        if (zoom.s === 1 || inside || box.width > vw || box.height > vh) return false;
        await (w.__demo as { zoom(b: Box, s: number, ms: number): Promise<void> }).zoom(box, zoom.s, 400);
        return true;
      },

      async unzoom(ms: number) {
        if (zoom.s === 1 && !zoom.tx && !zoom.ty) return;
        await setZoom(1, 0, 0, ms);
        for (const prop of ["transform", "transform-origin", "transition"]) document.body.style.removeProperty(prop);
      },
    };
  };

  if (document.documentElement) install();
  else document.addEventListener("DOMContentLoaded", install, { once: true });
}
