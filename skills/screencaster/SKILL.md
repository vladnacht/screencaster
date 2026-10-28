---
name: screencaster
description: Produces a lightweight demo video (MP4/MKV) or PNG screenshots of a web feature or a browser tab from a plain description, with specialized subagents (target, script, capture, review). Use when the user types /screencaster or asks to record a demo, film a feature, make a video of a flow, capture or screenshot a tab or a page (also in other languages, e.g. « filmer », « enregistrer une démo », « capturer l'onglet »).
argument-hint: "<description> [--video|--shot] [--mkv] [--max-mb N] [--mobile] [--headed]"
---

# /screencaster: orchestrator

You coordinate 4 subagents and the **demo-capture** MCP server. You keep a JSON **brief** (description, language, options, target, plan, capture, review, retakes) that you fill in at each step and pass **in full** in each subagent's prompt: they do not see this conversation.

Request: `$ARGUMENTS`

**Language**: reply to the user in the language of their request. Put it in the brief as `language` (e.g. `"fr"`, `"en"`), so captions and slugs follow it.

## 0. Prepare
- Read the options in the request: `--video` / `--shot` → `forceMode`; `--mkv` → `format: "mkv"`; `--max-mb N` → `maxMb` (10 at most: the server never delivers a video over 10 MB); `--mobile` → 390×844 viewport; `--headed` → visible browser.
- `projectDir` = the current working directory.
- Call `check_setup` (on first use it downloads ffmpeg, and sometimes Chromium: tell the user it can take a minute). It returns `pluginRoot` and `chromeDebugScript`: never search the disk for the plugin folder. If ffmpeg is missing, tell the user to run `node <pluginRoot>/scripts/setup.mjs` once, then restart Claude Code, and stop there. If the `check_setup` tool does not exist at all, the MCP server did not start: ask the user to restart Claude Code (the first install takes a few seconds).

## 1. Target: subagent `screencaster:target-resolver`
Pass `description` and `projectDir`.
- `blocked: "chrome-debug"`: if the request contains a URL, do not block: run the resolver again and require `source: launch`. Otherwise give the user the `chromeDebugScript` command (from `check_setup`), tell them to open the tab in that window and try again, and stop.
- `confidence` < 0.8 or several `candidates`: ask the user to choose (AskUserQuestion, one tab or URL per option).
- `serverRunning: false`: offer to run `startCommand` in the background (Bash `run_in_background`). Wait until the URL answers before going on.

## 2. Plan: subagent `screencaster:demo-planner`
If `projectDir` is a git repository on a feature branch, add `changes` to the brief: the output of `git diff --stat` and `git log --oneline` against the base branch. The planner has no shell, so it relies on this list.
Pass the brief (description, language, options, target, projectDir, changes).
- `risks` not empty: show each risk to the user and ask for their approval before going on.
- Otherwise state in one line the chosen mode, the number of steps and the target length, then go on without waiting.

## 3. Capture: subagent `screencaster:capture-operator`
Pass the brief (target, plan, projectDir, the `headed` option, and `retakeIssues` if any). The operator plays the whole take in a single `run_storyboard` call: no dead time, and short states are caught.
- `status: "failed"`: one more attempt with the error in `retakeIssues`. If it fails again, report the error to the user, call `close_target` and stop.

## 4. Review: subagent `screencaster:media-reviewer`
Pass description, plan and capture.
- `verdict: "retake"` and fewer than 2 retakes so far: go back to step 3 with `retakeIssues` = `issues` + `retakeHints`.
- `secretsVisible: true`: **do not finalize**. Warn the user and offer a new take.
- Still `retake` after 2 retakes: finalize anyway, and list the remaining problems clearly.

## 5. Finalize (`finalize` tool, no subagent)
- Video: `kind: "video"`, `project` = `target.project`, `featureSlug` = `plan.featureSlug`, `description`, `format`, `maxMb`, `trimStart`, `trimEnd` and `posterAt` (copied as is from the reviewer: they refer to the raw recording), `qa: { verdict, issues }`.
- Screenshots: `kind: "shot"` with the same `project` / `featureSlug`, and `rawFiles` = `capture.rawShots`.
- `both` mode: both calls.
- Then `close_target`.

## 6. Report
For each file, give in a few lines the full path (in `~/Documents/Demos/…` or `$SCREENCASTER_OUTPUT_DIR`), the size, the length, the thumbnail and any problem the review raised. In a git repository on a feature branch, offer to attach the video or screenshots to the pull request. The repository is never an output location.

## Rules
- Subagents run with the Agent tool, `subagent_type` = `screencaster:<name>`, one after the other: each step depends on the previous one.
- One browser session at a time. Do not use any other browser tool during a demo.
- Never write a credential in your messages or in subagent prompts.
