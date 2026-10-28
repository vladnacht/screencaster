# screencaster

**English** · [Français](README.fr.md)

A Claude Code plugin that turns a plain description into **a lightweight demo video (MP4 or MKV)** or **PNG screenshots**:
- of a feature in a web app (localhost, staging), signing in with a test account;
- of a tab already open in your Chrome.

```
/screencaster record the CSV export I just built
/screencaster screenshot the Stripe dashboard tab --shot
/screencaster the sign-up flow on mobile --mobile --max-mb 5
```

Files go to **`~/Documents/Demos/<project>/<date>/`** on macOS, Windows and Linux. They are never written into your repository. The agent answers in the language you write in.

## Features

**What it can record**
- A web app the agent opens in a browser: localhost, a staging environment, or a local HTML file.
- A tab already open in your Chrome, found from its description (title, domain). When several tabs match, the agent asks which one.
- The URL, the dev server port and the start page are read from the project (`package.json`, `.claude/launch.json`, `docker-compose`, README). If the server is down, the agent offers to start it.

**Video or screenshot**
- The agent decides: a flow or an animation becomes a video; a static state or a before/after becomes screenshots. It can also produce both.
- `--video` or `--shot` forces the mode.

**Demo script**
- A storyboard written with the page's real selectors. Available actions: go to a URL, click, hover, type text, press a key, scroll, wait for an element, sign in, take a screenshot.
- Each step can carry a caption banner, and each action can wait for an element (a confirmation toast, for example).
- The take is recorded in one go, with no dead time.
- Irreversible actions (payment, sending, deleting) are flagged and need your approval.

**Signing in to protected pages**
- Sign-in uses a test account, off camera.
- Credentials are read by the server and typed straight into the page: they never go through the model, the logs or the output files.

**Demo look**
- Visible fake cursor, click ripple, captions, dev overlays hidden (Next, Vite, devtools).
- Desktop 1440×900, or mobile 390×844 with `--mobile`. `--headed` shows the browser while recording.

**Quality check**
- A reviewer looks at frames from the video. It checks that the feature is visible and that there is no error, no unexpected sign-in page and no readable secret.
- Up to 2 retakes when the video is not right. A video that shows a secret is never delivered.
- Dead time at the start and end is trimmed, and the poster frame is chosen.

**Output files**
- Lightweight MP4 (or MKV with `--mkv`), **never more than 10 MB** whatever the length, and optimized PNGs.
- Deterministic name (date, time, project, feature, kind, size), a `.poster.png` thumbnail and a `.meta.json` (timed steps, length, size, review verdict).
- Stored in `~/Documents/Demos/<project>/<date>/` on macOS, Windows and Linux, never in the repository.

## How it works

```
/screencaster "<description>"          orchestrator skill
  ├─ target-resolver   (haiku)        what to record: a Chrome tab or the app URL, test account
  ├─ demo-planner      (sonnet)       video or screenshot, storyboard with real selectors, name slug
  ├─ capture-operator  (sonnet)       runs the storyboard through the demo-capture MCP server
  ├─ media-reviewer    (sonnet)       looks at the frames: feature visible? error? secret? trim
  └─ finalize          (code)         compression, name, thumbnail, meta.json → Documents
```

- Each subagent gets only the tools it needs: none can run shell commands, write files or browse the web, so a page with hidden instructions cannot make them act on your machine.
- A subagent only where judgment is needed. Naming, compression and filing are code: deterministic and free.
- One browser, owned by the MCP server: what is recorded is exactly what was driven.
- The take runs in one go on the server (`run_storyboard`): no dead time while the model thinks, and short states such as a 2 s toast are caught.
- Capture through CDP `Page.startScreencast`, the same for a launched Chromium and for a tab of your Chrome.
- A review loop: up to 2 retakes when the video does not show the feature.
- A demo look: visible fake cursor, click ripple, caption banners, dev overlays hidden (Next, Vite, devtools).

## Network and data

Nothing is sent to the plugin's author: there is no telemetry and no backend.

- **Network**: the browser loads the pages you ask to record, with their own requests. `check_url` sends one GET to your dev server to see if it answers. On first start the plugin downloads its npm packages (`npm ci`, pinned by `package-lock.json`), the ffmpeg binary of `ffmpeg-static` from its GitHub releases, and Playwright's Chromium only when Chrome is missing.
- **Credentials**: test accounts are read from `SCREENCASTER_ACCOUNTS`, `.screencaster/accounts.json` or a project `.env` file, and typed only on a local app or an origin you listed (see [Test accounts](#test-accounts)). They are never sent anywhere else, logged or written to a file.
- **Stored on your machine**: videos, screenshots, thumbnails and `meta.json` in `~/Documents/Demos`. They show whatever the recorded page shows, personal data included. Raw recordings sit in a temporary folder that is deleted when the server stops.

## Installation (once per machine)

Requirements: Node 20 or later, and Claude Code. ffmpeg comes from `ffmpeg-static`. Google Chrome is used when installed; otherwise Playwright's Chromium is downloaded. On Linux without Chrome, Chromium needs system libraries: run `sudo npx playwright install-deps chromium` once.

```bash
claude plugin marketplace add vladnacht/screencaster
claude plugin install screencaster@screencaster
```

Restart Claude Code. The `demo-capture` server starts with the plugin and installs itself on first start (a few seconds). The first `/screencaster` then downloads ffmpeg, and Chromium when Chrome is missing (about a minute). To do all of it up front, run `node scripts/setup.mjs` from a clone of this repository.

## Recording a tab of your Chrome

Chrome only allows remote control on a **dedicated profile**. Start it with:

```bash
scripts/chrome-debug.sh                                          # macOS / Linux
powershell -ExecutionPolicy Bypass -File scripts\chrome-debug.ps1   # Windows
```

`/screencaster` gives you the full path of the script when it needs it. The profile is kept in `~/.screencaster/chrome-profile`: sign in to your sites once in that window and the session is kept. Then open the tab to record and run `/screencaster …`. When the agent detaches, the tab stays open.

## Test accounts

The server reads the credentials and types them straight into the page. They never go through the model, the logs or `meta.json`. Sources, in order of priority:

1. Environment variable `SCREENCASTER_ACCOUNTS='{"admin":{"username":"…","password":"…"}}'`
2. `<project>/.screencaster/accounts.json` (same format; add it to `.gitignore`)
3. `~/.screencaster/accounts.json`
4. Or keys from a project `.env` file (`envFile` + `userKey` + `passKey`), which the resolver finds by their **name**. Only a `.env*` file inside the project is accepted.

Credentials are typed only on a local app (`localhost`, `127.0.0.1`, `*.localhost`, `*.test`, local files). To sign in on a staging site, list its origin with the account, `{"admin": {"username": "…", "password": "…", "origins": ["https://staging.acme.com"]}}`, or in `SCREENCASTER_LOGIN_ORIGINS` (comma-separated). The agent never types them on any other page.

## Output

```
~/Documents/Demos/acme-shop/2026-10-27/
  2026-10-27_1432_acme-shop_export-csv_video_1440x900.mp4
  2026-10-27_1432_acme-shop_export-csv_video_1440x900.poster.png
  2026-10-27_1432_acme-shop_export-csv_video_1440x900.meta.json   (timed steps, length, size, QA verdict)
  2026-10-27_1435_acme-shop_export-csv_shot_1440x900.png
```

**Size**: a video is **never larger than 10 MB**, whatever its length. H.264 CRF 28 at 15 fps, width capped at 1280 px, no audio, `faststart`. A 30 s demo usually weighs a few hundred KB. If the file goes over the cap (8 MB by default, up to 10 MB, small enough to upload to a GitHub pull request), it is re-encoded in 2 passes at a bitrate that fits. If that is not enough, bitrate, resolution (down to 320 px) and frame rate (down to 5 fps) step down. If even that fails (hours of video), `finalize` stops rather than deliver a file that is too large.

## Options and settings

| `/screencaster` | Effect |
|---|---|
| `--video` / `--shot` | force the mode (otherwise the planner decides) |
| `--mkv` | MKV container instead of MP4 |
| `--max-mb N` | video size cap (10 MB at most) |
| `--mobile` | 390×844 viewport |
| `--headed` | browser visible while recording |

| Variable | Default |
|---|---|
| `SCREENCASTER_OUTPUT_DIR` | `~/Documents/Demos` |
| `SCREENCASTER_MAX_MB` | `8` (capped at 10) |
| `SCREENCASTER_CDP_URL` | `http://127.0.0.1:9222` |
| `SCREENCASTER_STEP_PAUSE_MS` | `600` (pause after each action) |
| `SCREENCASTER_FFMPEG` | ffmpeg-static, else `ffmpeg` on PATH |
| `SCREENCASTER_LOGIN_ORIGINS` | none: origins besides local ones where test accounts may be typed |
| `SCREENCASTER_CHROME`, `SCREENCASTER_CHROME_PROFILE` | for `chrome-debug` |

## Development

```bash
node scripts/setup.mjs              # install, build, ffmpeg, browser
cd mcp/demo-capture && npm test     # naming, Documents folder, size, 2 passes, 10 MB cap
node scripts/e2e.mjs                # launched browser: recording, screenshot, finalize
node scripts/e2e-chrome.mjs         # attached Chrome tab: listing, ambiguity, detach
```

The CI runs all of the above on Linux, macOS and Windows, plus a Linux job without Chrome.

MCP tools: `run_storyboard` (the whole take), `check_setup`, `list_targets`, `list_accounts`, `open_target`, `snapshot`, `navigate`, `click`, `hover`, `type`, `press`, `scroll`, `wait_for`, `login`, `start_recording`, `mark_step`, `stop_recording`, `screenshot`, `extract_frames`, `finalize`, `close_target`.

## License

MIT
