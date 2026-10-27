import type { Page } from "playwright";
import { z } from "zod";
import * as act from "./actions.js";
import { resolveAccount } from "./secrets.js";

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

export const stepSchema = z.object({
  n: z.number().optional(),
  action: z.enum(["navigate", "click", "type", "press", "hover", "scroll", "wait_for", "screenshot", "login"]),
  ...target,
  value: z.string().optional().describe("Texte à taper (type)"),
  url: z.string().optional().describe("navigate"),
  key: z.string().optional().describe("press"),
  dy: z.number().optional().describe("scroll"),
  ms: z.number().optional().describe("wait_for : pause fixe"),
  fullPage: z.boolean().optional(),
  pressEnter: z.boolean().optional(),
  clear: z.boolean().optional(),
  label: z.string().optional().describe("Intitulé du chapitre dans meta.json"),
  caption: z.string().nullable().optional().describe("Bandeau affiché à partir de cette étape ; null l'efface"),
  recorded: z.boolean().optional().describe("false : exécutée avant le début de l'enregistrement (login)"),
  expect: z.object({ ...target, timeoutMs: z.number().optional() }).optional().describe("Élément à attendre après l'action"),
  account: z.string().optional(),
  envFile: z.string().optional(),
  userKey: z.string().optional(),
  passKey: z.string().optional(),
});

export type StoryStep = z.infer<typeof stepSchema>;

const hasTarget = (t: act.TargetRef) => !!(t.selector || t.text || t.role);

export function describeStep(s: StoryStep): string {
  const t = s.name ?? s.text ?? s.selector ?? s.url ?? s.key ?? (s.ms ? `${s.ms} ms` : "");
  return s.label ?? `${s.action}${t ? ` ${t}` : ""}`;
}

/** Runs one storyboard step. `shot` takes a screenshot and returns its file. */
export async function runStep(
  page: Page,
  s: StoryStep,
  ctx: { projectDir: string; shot: (o: act.TargetRef & { fullPage?: boolean }) => Promise<string> },
): Promise<string | undefined> {
  let file: string | undefined;
  switch (s.action) {
    case "navigate":
      if (!s.url) throw new Error("navigate sans url");
      await page.goto(new URL(s.url, page.url()).toString(), { waitUntil: "load" });
      await act.settle(page);
      break;
    case "click":
      await act.click(page, s);
      break;
    case "hover":
      await act.hover(page, s);
      break;
    case "type":
      await act.typeInto(page, s, s.value ?? "", { clear: s.clear, pressEnter: s.pressEnter });
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
  }
  if (s.expect && hasTarget(s.expect)) {
    await act.locate(page, s.expect).waitFor({ state: "visible", timeout: s.expect.timeoutMs ?? 15_000 });
  }
  return file;
}
