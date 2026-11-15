import type { Page } from "playwright";
import { z } from "zod";
import * as act from "./actions.js";
import { loginAllowed, resolveAccount } from "./secrets.js";

const DEFAULT_USER_SELECTOR =
  "input[type=email], input[name*=email i], input[name*=user i], input[name*=login i], input[autocomplete=username]";
const DEFAULT_SUBMIT_SELECTOR =
  'button[type=submit], input[type=submit], button:has-text("Connexion"), button:has-text("Se connecter"), button:has-text("Log in"), button:has-text("Sign in")';

export interface LoginRef {
  account?: string;
  envFile?: string;
  userKey?: string;
  passKey?: string;
  usernameSelector?: string;
  passwordSelector?: string;
  submitSelector?: string;
}

/** Fills the login form with a test account read server-side; values never leave this function. */
export async function login(page: Page, projectDir: string, ref: LoginRef): Promise<void> {
  const acc = resolveAccount(projectDir, ref);
  await act.unzoom(page, 0).catch(() => {});
  if (!loginAllowed(page.url(), acc)) {
    throw new Error(
      `Connexion refusée sur ${new URL(page.url()).origin} : les identifiants ne sont tapés que sur une app locale ou une origine listée (« origins » du compte dans accounts.json, ou SCREENCASTER_LOGIN_ORIGINS).`,
    );
  }
  const user = page.locator(ref.usernameSelector ?? DEFAULT_USER_SELECTOR).first();
  await user.waitFor({ state: "visible", timeout: 10_000 });
  await user.fill(acc.username);
  await page.locator(ref.passwordSelector ?? "input[type=password]").first().fill(acc.password);
  await act.click(page, { selector: ref.submitSelector ?? DEFAULT_SUBMIT_SELECTOR });
  await page.waitForLoadState("load").catch(() => {});
}

const target = {
  selector: z.string().optional(),
  text: z.string().optional(),
  role: z.string().optional(),
  name: z.string().optional(),
};

export const highlightSchema = z.object({
  label: z.string().optional().describe("Petite étiquette en haut à gauche du cadre"),
  color: z.string().optional().describe("Couleur CSS du cadre (défaut : accent orange)"),
  ms: z.number().min(0).optional().describe("Maintien avant l'action (défaut 900)"),
});

export const stepSchema = z.object({
  n: z.number().optional(),
  action: z.enum(["navigate", "click", "type", "press", "hover", "scroll", "wait_for", "screenshot", "login", "card", "highlight", "zoom", "unzoom"]),
  ...target,
  value: z.string().optional().describe("Texte à taper (type)"),
  url: z.string().optional().describe("navigate"),
  key: z.string().optional().describe("press"),
  dy: z.number().optional().describe("scroll"),
  ms: z.number().min(0).optional().describe("wait_for : pause fixe ; card : durée affichée (4000) ; highlight : maintien (900) ; zoom/unzoom : transition (600)"),
  title: z.string().optional().describe("card : titre (requis)"),
  body: z.string().optional().describe("card : texte, retours à la ligne permis"),
  bullets: z.array(z.string()).optional().describe("card : puces"),
  kicker: z.string().optional().describe("card : petite étiquette au-dessus du titre"),
  scale: z.number().min(1).max(3).optional().describe("zoom : grossissement (1.8)"),
  highlight: z.union([z.boolean(), highlightSchema]).optional().describe("click/type/hover/highlight : encadre la cible avant d'agir"),
  fullPage: z.boolean().optional(),
  pressEnter: z.boolean().optional(),
  clear: z.boolean().optional(),
  label: z.string().optional().describe("Intitulé de l'étape dans le résultat de finalize"),
  caption: z.string().nullable().optional().describe("Bandeau affiché à partir de cette étape ; null l'efface"),
  recorded: z.boolean().optional().describe("false : exécutée avant le début de l'enregistrement (login)"),
  expect: z.object({ ...target, timeoutMs: z.number().optional() }).optional().describe("Élément à attendre après l'action"),
  account: z.string().optional(),
  envFile: z.string().optional(),
  userKey: z.string().optional(),
  passKey: z.string().optional(),
}).refine((s) => s.action !== "card" || !!s.title, { message: "card sans title", path: ["title"] });

export type StoryStep = z.infer<typeof stepSchema>;

const hasTarget = (t: act.TargetRef) => !!(t.selector || t.text || t.role);

export function describeStep(s: StoryStep): string {
  const t = s.name ?? s.text ?? s.selector ?? s.title ?? s.url ?? s.key ?? (s.ms ? `${s.ms} ms` : "");
  return s.label ?? `${s.action}${t ? ` ${t}` : ""}`;
}

/** Runs one storyboard step. `shot` takes a screenshot and returns its file. */
export async function runStep(
  page: Page,
  s: StoryStep,
  ctx: { projectDir: string; shot: (o: act.TargetRef & { fullPage?: boolean }) => Promise<string> },
): Promise<string | undefined> {
  let file: string | undefined;
  const hl = s.highlight === true ? {} : s.highlight || undefined;
  const lit = (action: () => Promise<void>) => (hl ? act.withHighlight(page, s, hl, action) : action());
  switch (s.action) {
    case "navigate":
      if (!s.url) throw new Error("navigate sans url");
      await act.unzoom(page, 0).catch(() => {});
      await page.goto(new URL(s.url, page.url()).toString(), { waitUntil: "load" });
      await act.settle(page);
      break;
    case "click":
      await lit(() => act.click(page, s));
      break;
    case "hover":
      await lit(() => act.hover(page, s));
      break;
    case "type":
      await lit(() => act.typeInto(page, s, s.value ?? "", { clear: s.clear, pressEnter: s.pressEnter }));
      break;
    case "press":
      await page.keyboard.press(s.key ?? "Enter");
      await act.settle(page);
      break;
    case "scroll":
      await act.scroll(page, s, s.dy ?? 600);
      break;
    case "wait_for":
      if (hasTarget(s)) await act.locate(page, s).waitFor({ state: "visible", timeout: 15_000 });
      if (s.ms) await page.waitForTimeout(s.ms);
      break;
    case "screenshot":
      file = await ctx.shot({ ...s, fullPage: s.fullPage });
      break;
    case "login":
      await login(page, ctx.projectDir, s);
      break;
    case "card":
      if (!s.title) throw new Error("card sans title");
      await act.card(page, { title: s.title, body: s.body, bullets: s.bullets, kicker: s.kicker }, s.ms ?? 4000);
      break;
    case "highlight":
      await act.withHighlight(page, s, { ...hl, ms: s.ms ?? hl?.ms }, async () => {});
      break;
    case "zoom":
      await act.zoom(page, s, s.scale ?? 1.8, s.ms ?? 600);
      break;
    case "unzoom":
      await act.unzoom(page, s.ms ?? 600);
      break;
  }
  if (s.expect && hasTarget(s.expect)) {
    await act.locate(page, s.expect).waitFor({ state: "visible", timeout: s.expect.timeoutMs ?? 15_000 });
  }
  return file;
}
