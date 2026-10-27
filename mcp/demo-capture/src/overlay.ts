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

/**
 * Runs in the page (as an init script and on attach). Adds a visible fake cursor with
 * a click ripple, a caption bar driven by `window.__demo.caption()`, and hides dev
 * overlays. Must stay self-contained: Playwright serialises it.
 */
export function DEMO_INIT_SCRIPT({ hideSelectors }: { hideSelectors: string[] }): void {
  const w = window as unknown as { __demo?: unknown };
  if (w.__demo) return;

  const install = () => {
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

    w.__demo = {
      caption(text: string | null) {
        caption.textContent = text ?? "";
        caption.classList.toggle("on", !!text);
      },
    };
  };

  if (document.documentElement) install();
  else document.addEventListener("DOMContentLoaded", install, { once: true });
}
