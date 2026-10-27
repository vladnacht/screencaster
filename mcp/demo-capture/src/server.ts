#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as act from "./actions.js";
import { DEFAULT_CDP_URL, listChromeTabs, Session, toUrl } from "./browser.js";
import { checkFfmpeg, defaultVideoOptions, encodeVideo, extractFrames, extractPoster, optimizePng } from "./encode.js";
import { buildBaseName, outputDir, outputRoot, uniquePath } from "./naming.js";
import { DEFAULT_HIDE_SELECTORS } from "./overlay.js";
import { Recorder, type Step } from "./recorder.js";
import { listAccounts } from "./secrets.js";
import { describeStep, login, runStep, stepSchema, type LoginRef, type StoryStep } from "./storyboard.js";

// ---------- state: one browser session, one recording at a time ----------

let session: Session | undefined;
let recorder: Recorder | undefined;
let lastRecording: { file: string; durationSec: number; steps: Step[]; viewport: { width: number; height: number }; url: string } | undefined;
let shots: string[] = [];
const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "demo-agent-"));

const ok = (data: unknown) => ({ content: [{ type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] });
const fail = (e: unknown) => ({ isError: true, content: [{ type: "text" as const, text: e instanceof Error ? e.message : String(e) }] });
const human = (bytes: number) => (bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} Mo` : `${Math.round(bytes / 1024)} Ko`);

function page() {
  if (!session) throw new Error("Aucune cible ouverte : appelle open_target d'abord.");
  return session.page;
}

/** Wraps a handler so errors come back as tool errors instead of crashing the server. */
function tool<A>(fn: (args: A) => Promise<unknown>) {
  return async (args: A) => {
    try {
      return ok(await fn(args));
    } catch (e) {
      return fail(e);
    }
  };
}

const targetRef = {
  selector: z.string().optional().describe('Sélecteur Playwright : CSS, text=…, role=button[name="…"], [data-testid=…]'),
  text: z.string().optional().describe("Texte visible de l'élément"),
  role: z.string().optional().describe("Rôle ARIA (button, link, textbox, tab…)"),
  name: z.string().optional().describe("Nom accessible associé au rôle"),
};

function pngSize(file: string): { width: number; height: number } {
  const b = fs.readFileSync(file);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

async function startRecording(fps: number): Promise<void> {
  if (recorder) throw new Error("Déjà en cours d'enregistrement.");
  page();
  const s = session!;
  const r = new Recorder(s.page, path.join(runDir, `rec-${Date.now()}.mp4`), fps, s.viewport);
  await r.start();
  recorder = r;
}

async function stopRecording() {
  if (!recorder) throw new Error("Aucun enregistrement en cours.");
  const r = recorder;
  recorder = undefined;
  await act.caption(page(), null);
  const res = await r.stop();
  lastRecording = { ...res, viewport: session!.viewport, url: page().url() };
  return { rawFile: res.file, durationSec: res.durationSec, steps: res.steps };
}

async function takeShot(a: act.TargetRef & { fullPage?: boolean }): Promise<string> {
  const p = page();
  const file = path.join(runDir, `shot-${Date.now()}.png`);
  if (a.selector || a.text || a.role) await act.locate(p, a).screenshot({ path: file });
  else await p.screenshot({ path: file, fullPage: !!a.fullPage });
  shots.push(file);
  return file;
}

// ---------- server ----------

const server = new McpServer({ name: "demo-capture", version: "0.1.1" });

server.registerTool(
  "check_setup",
  { description: "Vérifie ffmpeg et le dossier de sortie. À appeler une fois avant une démo." },
  tool(async () => {
    const ffmpeg = checkFfmpeg();
    const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    const script = path.join(pluginRoot, "scripts", process.platform === "win32" ? "chrome-debug.ps1" : "chrome-debug.sh");
    return { ffmpeg: ffmpeg ?? "ok", outputRoot: outputRoot(), pluginRoot, chromeDebugScript: script, chromeDebugUrl: DEFAULT_CDP_URL };
  }),
);

server.registerTool(
  "list_targets",
  {
    description:
      "Liste les onglets du Chrome attaché (lancé avec scripts/chrome-debug). Renvoie targetId, titre et URL de chaque onglet.",
    inputSchema: { cdpUrl: z.string().optional() },
  },
  tool(async ({ cdpUrl }: { cdpUrl?: string }) => listChromeTabs(cdpUrl ?? DEFAULT_CDP_URL)),
);

server.registerTool(
  "list_accounts",
  {
    description: "Noms des comptes de test disponibles pour login (jamais les valeurs).",
    inputSchema: { projectDir: z.string().optional().describe("Dossier du projet (défaut : cwd)") },
  },
  tool(async ({ projectDir }: { projectDir?: string }) => listAccounts(projectDir ?? process.cwd())),
);

server.registerTool(
  "open_target",
  {
    description:
      "Ouvre la cible à filmer. source=launch : lance un navigateur sur `url`. source=chrome : s'attache à un onglet existant (targetId ou match sur titre/URL). Ferme la cible précédente.",
    inputSchema: {
      source: z.enum(["launch", "chrome"]),
      url: z.string().optional(),
      targetId: z.string().optional(),
      match: z.string().optional().describe("Sous-chaîne du titre ou de l'URL de l'onglet (mode chrome)"),
      width: z.number().int().min(320).max(2560).default(1440),
      height: z.number().int().min(320).max(1600).default(900),
      headless: z.boolean().default(true),
      cdpUrl: z.string().optional(),
      storageState: z.string().optional().describe("Fichier Playwright storageState pour une session déjà connectée"),
      hideSelectors: z.array(z.string()).default([]).describe("Sélecteurs supplémentaires à masquer"),
    },
  },
  tool(async (a: {
    source: "launch" | "chrome"; url?: string; targetId?: string; match?: string; width: number; height: number;
    headless: boolean; cdpUrl?: string; storageState?: string; hideSelectors: string[];
  }) => {
    if (recorder) throw new Error("Un enregistrement est en cours : stop_recording d'abord.");
    await session?.close();
    session = undefined;
    shots = [];
    const hide = [...DEFAULT_HIDE_SELECTORS, ...a.hideSelectors];
    if (a.source === "launch") {
      if (!a.url) throw new Error("url requise en mode launch.");
      session = await Session.launch({ url: toUrl(a.url), viewport: { width: a.width, height: a.height }, headless: a.headless, storageState: a.storageState, hideSelectors: hide });
    } else {
      session = await Session.attach({ cdpUrl: a.cdpUrl ?? DEFAULT_CDP_URL, targetId: a.targetId, match: a.match, hideSelectors: hide });
    }
    return { source: session.source, viewport: session.viewport, url: session.page.url(), title: await session.page.title() };
  }),
);

server.registerTool(
  "snapshot",
  { description: "URL, titre et éléments interactifs visibles de la page (pour choisir des sélecteurs fiables)." },
  tool(async () => act.snapshot(page())),
);

server.registerTool(
  "navigate",
  { description: "Va à une URL (absolue ou relative à la page).", inputSchema: { url: z.string() } },
  tool(async ({ url }: { url: string }) => {
    const p = page();
    await p.goto(new URL(url, p.url()).toString(), { waitUntil: "load" });
    await act.settle(p);
    return { url: p.url(), title: await p.title() };
  }),
);

server.registerTool(
  "click",
  { description: "Déplace le curseur visible vers l'élément puis clique.", inputSchema: targetRef },
  tool(async (ref: act.TargetRef) => {
    await act.click(page(), ref);
    return { url: page().url() };
  }),
);

server.registerTool(
  "hover",
  { description: "Survole un élément (menus, tooltips).", inputSchema: targetRef },
  tool(async (ref: act.TargetRef) => act.hover(page(), ref).then(() => "ok")),
);

server.registerTool(
  "type",
  {
    description: "Tape du texte dans un champ, caractère par caractère. Jamais pour un mot de passe : utiliser login.",
    inputSchema: { ...targetRef, value: z.string(), clear: z.boolean().default(true), pressEnter: z.boolean().default(false) },
  },
  tool(async (a: act.TargetRef & { value: string; clear: boolean; pressEnter: boolean }) => {
    await act.typeInto(page(), a, a.value, { clear: a.clear, pressEnter: a.pressEnter });
    return "ok";
  }),
);

server.registerTool(
  "press",
  { description: "Appuie sur une touche (Enter, Escape, Tab, ArrowDown, Meta+K…).", inputSchema: { key: z.string() } },
  tool(async ({ key }: { key: string }) => {
    await page().keyboard.press(key);
    await act.settle(page());
    return "ok";
  }),
);

server.registerTool(
  "scroll",
  {
    description: "Fait défiler la page de dy pixels, ou jusqu'à un élément si un sélecteur est donné.",
    inputSchema: { ...targetRef, dy: z.number().default(600) },
  },
  tool(async (a: act.TargetRef & { dy: number }) => act.scroll(page(), a, a.dy).then(() => "ok")),
);

server.registerTool(
  "wait_for",
  {
    description: "Attend qu'un élément apparaisse (ou disparaisse), ou simplement `ms` millisecondes.",
    inputSchema: {
      ...targetRef,
      state: z.enum(["visible", "hidden", "attached", "detached"]).default("visible"),
      timeoutMs: z.number().default(15_000),
      ms: z.number().optional(),
    },
  },
  tool(async (a: act.TargetRef & { state: "visible" | "hidden" | "attached" | "detached"; timeoutMs: number; ms?: number }) => {
    const p = page();
    if (a.selector || a.text || a.role) await act.locate(p, a).waitFor({ state: a.state, timeout: a.timeoutMs });
    if (a.ms) await p.waitForTimeout(a.ms);
    return "ok";
  }),
);

server.registerTool(
  "login",
  {
    description:
      "Se connecte avec un compte de test. Les identifiants sont lus côté serveur (DEMO_AGENT_ACCOUNTS, .demo-agent/accounts.json, ou envFile+userKey+passKey) et ne sont jamais renvoyés.",
    inputSchema: {
      projectDir: z.string().optional(),
      account: z.string().optional().describe("Nom du compte (voir list_accounts)"),
      envFile: z.string().optional().describe("Fichier .env du projet contenant le compte de test, ex. .env.example"),
      userKey: z.string().optional(),
      passKey: z.string().optional(),
      usernameSelector: z.string().optional().describe("Défaut : champ email / username détecté"),
      passwordSelector: z.string().optional(),
      submitSelector: z.string().optional(),
    },
  },
  tool(async (a: LoginRef & { projectDir?: string }) => {
    const p = page();
    await login(p, a.projectDir ?? process.cwd(), a);
    return { loggedIn: true, url: p.url() };
  }),
);

server.registerTool(
  "start_recording",
  {
    description: "Démarre l'enregistrement vidéo de la page ouverte.",
    inputSchema: { fps: z.number().int().min(5).max(30).default(15) },
  },
  tool(async ({ fps }: { fps: number }) => {
    await startRecording(fps);
    return { recording: true, fps };
  }),
);

server.registerTool(
  "mark_step",
  {
    description: "Horodate une étape du storyboard dans l'enregistrement ; `caption` affiche aussi un bandeau dans la vidéo (null pour l'effacer).",
    inputSchema: { label: z.string(), caption: z.string().nullable().optional() },
  },
  tool(async ({ label, caption }: { label: string; caption?: string | null }) => {
    if (caption !== undefined) await act.caption(page(), caption);
    return recorder ? recorder.mark(label) : { label, note: "pas d'enregistrement en cours" };
  }),
);

server.registerTool(
  "stop_recording",
  { description: "Arrête l'enregistrement. Renvoie le fichier brut (temporaire), sa durée et les étapes horodatées." },
  tool(async () => stopRecording()),
);

server.registerTool(
  "screenshot",
  {
    description: "Capture PNG de la fenêtre visible (ou d'un élément, ou de la page entière). Renvoie le fichier brut (temporaire).",
    inputSchema: { ...targetRef, fullPage: z.boolean().default(false) },
  },
  tool(async (a: act.TargetRef & { fullPage: boolean }) => {
    const file = await takeShot(a);
    return { rawFile: file, ...pngSize(file), sizeKb: Math.round(fs.statSync(file).size / 1024) };
  }),
);

server.registerTool(
  "run_storyboard",
  {
    description:
      "Joue tout le storyboard d'un seul tenant, côté serveur, avec un timing régulier : les étapes recorded:false de tête (login) avant l'enregistrement, puis l'enregistrement (si record), chaque étape horodatée, ses légendes, ses expect et ses screenshots, une pause finale et l'arrêt. À préférer aux appels d'outils un par un, qui laissent des temps morts dans la vidéo et ratent les états brefs (toasts). En cas d'échec, l'enregistrement est arrêté et la réponse donne l'étape fautive et un snapshot de la page.",
    inputSchema: {
      steps: z.array(stepSchema).min(1),
      record: z.boolean().default(true),
      fps: z.number().int().min(5).max(30).default(15),
      holdMs: z.number().min(0).max(10_000).default(1500).describe("Pause finale sur le résultat"),
      projectDir: z.string().optional().describe("Pour les étapes login"),
    },
  },
  tool(async (a: { steps: StoryStep[]; record: boolean; fps: number; holdMs: number; projectDir?: string }) => {
    const p = page();
    const ctx = { projectDir: a.projectDir ?? process.cwd(), shot: takeShot };
    const firstRecorded = a.steps.findIndex((s) => s.recorded !== false);
    const pre = firstRecorded === -1 ? a.steps : a.steps.slice(0, firstRecorded);
    const main = firstRecorded === -1 ? [] : a.steps.slice(firstRecorded);
    const rawShots: string[] = [];
    let failed: { n: number; step: string; error: string; snapshot: string } | undefined;

    const run = async (list: StoryStep[], offset: number) => {
      for (const [i, s] of list.entries()) {
        try {
          if (recorder) recorder.mark(describeStep(s));
          if (s.caption !== undefined) await act.caption(p, s.caption);
          const shot = await runStep(p, s, ctx);
          if (shot) rawShots.push(shot);
        } catch (e) {
          failed = {
            n: s.n ?? offset + i + 1,
            step: describeStep(s),
            error: (e instanceof Error ? e.message : String(e)).split("\n")[0],
            snapshot: await act.snapshot(p, 40).catch(() => ""),
          };
          return;
        }
      }
    };

    await run(pre, 0);
    if (failed) return { status: "failed", failedStep: failed };
    if (a.record && main.length) await startRecording(a.fps);
    await run(main, pre.length);
    if (!failed && a.holdMs) await p.waitForTimeout(a.holdMs);
    const rec = recorder ? await stopRecording() : undefined;
    return {
      status: failed ? "failed" : "ok",
      rawVideo: rec?.rawFile,
      durationSec: rec?.durationSec,
      steps: rec?.steps,
      rawShots,
      failedStep: failed,
    };
  }),
);

server.registerTool(
  "extract_frames",
  {
    description: "Extrait des images PNG d'une vidéo pour la relecture (par défaut le dernier enregistrement). Lis-les avec Read.",
    inputSchema: { file: z.string().optional(), count: z.number().int().min(1).max(12).default(5), at: z.array(z.number()).optional() },
  },
  tool(async ({ file, count, at }: { file?: string; count: number; at?: number[] }) => {
    const video = file ?? lastRecording?.file;
    if (!video) throw new Error("Aucune vidéo : passe file ou enregistre d'abord.");
    return extractFrames(video, path.join(runDir, `frames-${Date.now()}`), count, at);
  }),
);

server.registerTool(
  "finalize",
  {
    description:
      "Compresse, nomme et range la démo dans Documents/Demos/<projet>/<date>/ avec une vignette et un .meta.json. kind=video : dernier enregistrement. kind=shot : captures de la session (ou rawFiles).",
    inputSchema: {
      kind: z.enum(["video", "shot"]),
      project: z.string().describe("Nom court du projet ou du site"),
      featureSlug: z.string().describe("Ce que montre la démo, en kebab-case : export-csv, onboarding-step-2"),
      description: z.string(),
      rawFiles: z.array(z.string()).optional(),
      format: z.enum(["mp4", "mkv"]).default("mp4"),
      maxMb: z.number().positive().optional().describe("Plafond de poids en Mo (8 par défaut, jamais plus de 10)"),
      trimStart: z.number().min(0).optional(),
      trimEnd: z.number().min(0).optional(),
      posterAt: z.number().min(0).optional().describe("Instant (s) de la vignette sur l'enregistrement brut ; défaut : dernière étape"),
      qa: z.object({ verdict: z.string(), issues: z.array(z.string()).default([]) }).optional(),
    },
  },
  tool(async (a: {
    kind: "video" | "shot"; project: string; featureSlug: string; description: string; rawFiles?: string[];
    format: "mp4" | "mkv"; maxMb?: number; trimStart?: number; trimEnd?: number; posterAt?: number;
    qa?: { verdict: string; issues: string[] };
  }) => {
    const now = new Date();
    const dir = outputDir(a.project, now);
    fs.mkdirSync(dir, { recursive: true });
    const meta: Record<string, unknown> = {
      description: a.description,
      project: a.project,
      feature: a.featureSlug,
      kind: a.kind,
      createdAt: now.toISOString(),
      url: session?.page.url() ?? lastRecording?.url,
      qa: a.qa,
    };

    if (a.kind === "video") {
      const raw = a.rawFiles?.[0] ?? lastRecording?.file;
      if (!raw) throw new Error("Aucun enregistrement à finaliser.");
      const vp = lastRecording?.viewport ?? session?.viewport ?? { width: 1440, height: 900 };
      const base = buildBaseName({ project: a.project, featureSlug: a.featureSlug, kind: "video", ...vp, ext: a.format, date: now });
      const out = uniquePath(dir, base, a.format);
      const opts = { ...defaultVideoOptions(), format: a.format, trimStart: a.trimStart, trimEnd: a.trimEnd };
      if (a.maxMb) opts.maxMb = a.maxMb;
      const enc = await encodeVideo(raw, out, opts);
      const stem = out.slice(0, -(a.format.length + 1));
      const steps = (lastRecording?.steps ?? []).map((s) => ({ ...s, t: Number((s.t - (a.trimStart ?? 0)).toFixed(2)) }));
      // posterAt, like trimStart/trimEnd, is on the raw recording's timeline.
      const posterAt =
        a.posterAt !== undefined
          ? a.posterAt - (a.trimStart ?? 0)
          : steps.length ? steps[steps.length - 1].t + 0.8 : enc.durationSec * 0.7;
      const poster = await extractPoster(out, `${stem}.poster.png`, Math.min(Math.max(0, posterAt), enc.durationSec - 0.1));
      Object.assign(meta, {
        file: path.basename(out), viewport: vp, durationSec: Number(enc.durationSec.toFixed(2)),
        sizeBytes: enc.sizeBytes, encoding: { passes: enc.passes, maxMb: enc.maxMb, fps: enc.fps, maxWidth: enc.width }, steps,
      });
      fs.writeFileSync(`${stem}.meta.json`, JSON.stringify(meta, null, 2));
      return { file: out, size: human(enc.sizeBytes), durationSec: meta.durationSec, poster, meta: `${stem}.meta.json`, passes: enc.passes };
    }

    const raws = a.rawFiles?.length ? a.rawFiles : shots;
    if (!raws.length) throw new Error("Aucune capture à finaliser.");
    const files = [];
    for (const [i, raw] of raws.entries()) {
      const dim = pngSize(raw);
      const base = buildBaseName({
        project: a.project, featureSlug: a.featureSlug, kind: "shot", ...dim, ext: "png", date: now,
        index: raws.length > 1 ? i + 1 : undefined,
      });
      const out = uniquePath(dir, base, "png");
      const size = await optimizePng(raw, out);
      files.push({ file: out, size: human(size), sizeBytes: size, ...dim });
    }
    // Named after the first PNG, which uniquePath already made unique: a second batch in the same minute keeps its own meta.
    const stem = files[0].file.slice(0, -".png".length);
    Object.assign(meta, { files: files.map((f) => ({ file: path.basename(f.file), sizeBytes: f.sizeBytes, width: f.width, height: f.height })) });
    fs.writeFileSync(`${stem}.meta.json`, JSON.stringify(meta, null, 2));
    shots = [];
    return { files: files.map(({ file, size, width, height }) => ({ file, size, width, height })), meta: `${stem}.meta.json` };
  }),
);

server.registerTool(
  "close_target",
  { description: "Ferme le navigateur lancé, ou se détache du Chrome (ses onglets restent ouverts)." },
  tool(async () => {
    if (recorder) await recorder.stop().catch(() => {});
    recorder = undefined;
    await session?.close();
    session = undefined;
    return "fermé";
  }),
);

const shutdown = async () => {
  await session?.close().catch(() => {});
  fs.rmSync(runDir, { recursive: true, force: true });
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.stdin.on("close", shutdown);

await server.connect(new StdioServerTransport());
