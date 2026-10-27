---
name: demo
description: Produit une vidéo de démo (MP4/MKV léger) ou des screenshots PNG d'une fonctionnalité web ou d'un onglet du navigateur, à partir d'une simple description, avec des sous-agents spécialisés (cible, scénario, prise de vue, relecture). À utiliser quand l'utilisateur tape /demo ou demande de « filmer », « enregistrer une démo », « faire une vidéo de la feature », « capturer l'onglet X », « screenshot de la page Y ».
argument-hint: "<description> [--video|--shot] [--mkv] [--max-mb N] [--mobile] [--headed]"
---

# /demo : orchestrateur

Tu coordonnes 4 sous-agents et le serveur MCP **demo-capture**. Tu gardes un **brief** JSON (description, options, target, plan, capture, review, retakes) que tu complètes à chaque étape et que tu transmets **en entier** dans le prompt de chaque sous-agent : ils ne voient pas cette conversation.

Demande : `$ARGUMENTS`

## 0. Préparer
- Lis les options dans la demande : `--video` / `--shot` → `forceMode` ; `--mkv` → `format: "mkv"` ; `--max-mb N` → `maxMb` ; `--mobile` → viewport 390×844 ; `--headed` → navigateur visible.
- `projectDir` = le dossier de travail courant.
- Appelle `check_setup`. Il renvoie `pluginRoot` et `chromeDebugScript` : ne cherche jamais le dossier du plugin sur le disque. Si ffmpeg manque, dis à l'utilisateur de lancer une fois `node <pluginRoot>/scripts/setup.mjs`, puis de relancer Claude Code. Arrête-toi là. Si l'outil `check_setup` n'existe pas du tout, le serveur MCP n'a pas démarré : demande à l'utilisateur de relancer Claude Code (la première installation prend environ 1 min).

## 1. Cible : sous-agent `demo-agent:target-resolver`
Transmets `description` et `projectDir`.
- `blocked: "chrome-debug"` : si la demande contient une URL, ne bloque pas : relance le resolver en lui imposant `source: launch`. Sinon, donne à l'utilisateur la commande `chromeDebugScript` (renvoyée par `check_setup`), dis-lui d'ouvrir l'onglet dans cette fenêtre puis de relancer, et arrête-toi.
- `confidence` < 0.8 ou plusieurs `candidates` : demande à l'utilisateur de choisir (AskUserQuestion, un onglet ou une URL par option).
- `serverRunning: false` : propose de lancer `startCommand` en arrière-plan (Bash `run_in_background`). Attends que l'URL réponde avant de continuer.

## 2. Plan : sous-agent `demo-agent:demo-planner`
Transmets le brief (description, options, target, projectDir).
- `risks` non vide : montre chaque risque à l'utilisateur et demande son accord avant de continuer.
- Sinon, annonce en une ligne le mode choisi, le nombre d'étapes et la durée visée, puis enchaîne sans attendre.

## 3. Prise de vue : sous-agent `demo-agent:capture-operator`
Transmets le brief (target, plan, projectDir, options `headed`, et `retakeIssues` s'il y en a). L'opérateur joue toute la prise en un seul appel `run_storyboard` : pas de temps morts, et les états brefs sont attrapés.
- `status: "failed"` : une seule nouvelle tentative avec l'erreur dans `retakeIssues`. Si elle échoue aussi, rapporte l'erreur à l'utilisateur, appelle `close_target` et arrête-toi.

## 4. Relecture : sous-agent `demo-agent:media-reviewer`
Transmets description, plan et capture.
- `verdict: "retake"` et moins de 2 reprises déjà faites : retourne à l'étape 3 avec `retakeIssues` = `issues` + `retakeHints`.
- `secretsVisible: true` : **ne finalise pas**. Préviens l'utilisateur et propose une nouvelle prise.
- Après 2 reprises toujours en `retake` : finalise quand même, et liste clairement les problèmes restants.

## 5. Finaliser (outil `finalize`, pas de sous-agent)
- Vidéo : `kind: "video"`, `project` = `target.project`, `featureSlug` = `plan.featureSlug`, `description`, `format`, `maxMb`, `trimStart`, `trimEnd` et `posterAt` (repris tels quels du reviewer : ils portent sur l'enregistrement brut), `qa: { verdict, issues }`.
- Screenshots : `kind: "shot"` avec les mêmes `project` / `featureSlug`, et `rawFiles` = `capture.rawShots`.
- Mode `both` : les deux appels.
- Puis `close_target`.

## 6. Rendre compte
Pour chaque fichier, donne en quelques lignes le chemin complet (dans `~/Documents/Demos/…` ou `$DEMO_AGENT_OUTPUT_DIR`), le poids, la durée, la vignette et les éventuels problèmes signalés par la relecture. Dans un dépôt git avec une branche de fonctionnalité, propose de joindre la vidéo ou les captures à la PR. Le dépôt n'est jamais un emplacement de sortie.

## Règles
- Les sous-agents se lancent avec l'outil Agent, `subagent_type` = `demo-agent:<nom>`, l'un après l'autre : chaque étape dépend de la précédente.
- Une seule session navigateur à la fois. N'utilise pas d'autre outil navigateur pendant une démo.
- Jamais d'identifiant en clair dans tes messages, ni dans les prompts des sous-agents.
- Recherche web éventuelle : outils Perplexity uniquement.
