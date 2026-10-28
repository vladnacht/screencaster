# demo-agent

Plugin Claude Code qui produit, à partir d'une simple description, **une vidéo de démo légère (MP4 ou MKV)** ou **des screenshots PNG** :
- d'une fonctionnalité d'une app web (localhost, staging), avec connexion par compte de test ;
- d'un onglet déjà ouvert dans ton Chrome.

```
/demo filme l'export CSV que je viens d'implémenter
/demo screenshot de l'onglet du dashboard Stripe --shot
/demo parcours d'inscription en mobile --mobile --max-mb 5
```

Les fichiers vont dans **`~/Documents/Demos/<projet>/<date>/`**, sur macOS, Windows et Linux. Ils ne sont jamais écrits dans le dépôt.

## Fonctionnalités

**Ce qu'on peut filmer**
- Une app web lancée par l'agent dans un navigateur : localhost, un environnement de staging, ou un fichier HTML local.
- Un onglet déjà ouvert dans ton Chrome, retrouvé à partir de sa description (titre, domaine). S'il y a plusieurs candidats, l'agent te demande lequel.
- L'URL, le port du serveur de dev et la page de départ sont trouvés dans le projet (`package.json`, `.claude/launch.json`, `docker-compose`, README). Si le serveur ne répond pas, l'agent propose de le lancer.

**Vidéo ou screenshot**
- L'agent choisit seul : un parcours ou une animation donne une vidéo, un état statique ou un avant/après donne des screenshots. Il peut aussi produire les deux.
- `--video` ou `--shot` force le mode.

**Scénario de la démo**
- Un storyboard écrit avec les vrais sélecteurs de la page. Actions possibles : aller à une URL, cliquer, survoler, taper du texte, appuyer sur une touche, défiler, attendre un élément, se connecter, prendre un screenshot.
- Une légende en bandeau peut accompagner chaque étape, et chaque action peut attendre un élément (par exemple le toast de confirmation).
- La prise se joue d'un seul tenant, sans temps morts.
- Les actions irréversibles (paiement, envoi, suppression) sont signalées et demandent ton accord.

**Connexion aux pages protégées**
- La connexion se fait avec un compte de test, hors caméra.
- Les identifiants sont lus par le serveur et tapés directement dans la page : ils ne passent jamais par le modèle, les logs ni les fichiers produits.

**Rendu de démo**
- Faux curseur visible, effet au clic, légendes, overlays de dev masqués (Next, Vite, devtools).
- Format bureau 1440×900, ou mobile 390×844 avec `--mobile`. `--headed` affiche le navigateur pendant la prise.

**Contrôle qualité**
- Un relecteur regarde des images de la vidéo. Il vérifie que la fonctionnalité est visible et qu'il n'y a ni erreur, ni page de login inattendue, ni secret lisible.
- Au plus 2 nouvelles prises si la vidéo ne convient pas. Une vidéo qui montre un secret n'est jamais livrée.
- Coupe automatique des temps morts au début et à la fin, et choix de la vignette.

**Fichiers produits**
- MP4 (ou MKV avec `--mkv`) léger, **jamais plus de 10 Mo** quelle que soit la durée, et PNG optimisés.
- Nom déterministe (date, heure, projet, fonctionnalité, type, dimensions), vignette `.poster.png` et `.meta.json` (étapes horodatées, durée, poids, verdict de la relecture).
- Rangés dans `~/Documents/Demos/<projet>/<date>/` sur macOS, Windows et Linux, jamais dans le dépôt.

## Comment ça marche

```
/demo "<description>"                 skill orchestrateur
  ├─ target-resolver   (haiku)        quoi filmer : onglet Chrome ou URL de l'app, compte de test
  ├─ demo-planner      (sonnet)       vidéo ou screenshot, storyboard avec vrais sélecteurs, slug du nom
  ├─ capture-operator  (sonnet)       exécute le storyboard via le serveur MCP demo-capture
  ├─ media-reviewer    (sonnet)       regarde les images : fonctionnalité visible ? erreur ? secret ? coupe
  └─ finalize          (code)         compression, nom, vignette, meta.json → Documents
```

- Un sous-agent seulement là où il faut du jugement. Le nommage, la compression et le rangement sont du code : déterministes et gratuits.
- Un seul navigateur, détenu par le serveur MCP : ce qui est filmé est exactement ce qui a été piloté.
- La prise se joue d'un seul tenant côté serveur (`run_storyboard`) : pas de temps morts liés à la réflexion du modèle, et les états brefs comme un toast de 2 s sont attrapés.
- Une capture via CDP `Page.startScreencast`, identique pour un Chromium lancé et pour un onglet de ton Chrome.
- Une boucle de relecture : au plus 2 nouvelles prises si la vidéo ne montre pas la fonctionnalité.
- Un rendu de démo : faux curseur visible, effet au clic, légendes en bandeau, overlays de dev masqués (Next, Vite, devtools).

## Installation (une fois par machine)

Prérequis : Node 20 ou plus, et Claude Code. ffmpeg est fourni par `ffmpeg-static`. Google Chrome est utilisé s'il est installé, sinon le Chromium de Playwright est téléchargé.

```bash
git clone <ce dépôt> ~/demo-agent          # ou copie le dossier
node ~/demo-agent/scripts/setup.mjs         # npm install + build (+ Chromium si pas de Chrome)
claude plugin marketplace add ~/demo-agent
claude plugin install demo-agent@demo-agent
```

Relance Claude Code. Le serveur `demo-capture` démarre avec le plugin. Si `setup.mjs` n'a pas été lancé, le serveur s'installe tout seul au premier démarrage (quelques secondes), puis le premier `/demo` télécharge ffmpeg, et Chromium si Chrome est absent (environ une minute).

## Filmer un onglet de ton Chrome

Chrome n'autorise le pilotage à distance que sur un **profil dédié**. Lance-le avec :

```bash
~/demo-agent/scripts/chrome-debug.sh                       # macOS / Linux
powershell -ExecutionPolicy Bypass -File scripts\chrome-debug.ps1   # Windows
```

Le profil est gardé dans `~/.demo-agent/chrome-profile` : connecte-toi une fois à tes sites dans cette fenêtre, la session est conservée. Ouvre ensuite l'onglet à filmer, puis lance `/demo …`. Quand l'agent se détache, l'onglet reste ouvert.

## Comptes de test

Le serveur lit les identifiants et les tape directement dans la page. Ils ne passent jamais par le modèle, les logs ou `meta.json`. Sources, par ordre de priorité :

1. Variable d'environnement `DEMO_AGENT_ACCOUNTS='{"admin":{"username":"…","password":"…"}}'`
2. `<projet>/.demo-agent/accounts.json` (même format ; pense à l'ajouter à `.gitignore`)
3. `~/.demo-agent/accounts.json`
4. Ou des clés d'un fichier `.env` du projet (`envFile` + `userKey` + `passKey`), que le resolver repère par leur **nom**.

## Sorties

```
~/Documents/Demos/acme-shop/2026-10-27/
  2026-10-27_1432_acme-shop_export-csv_video_1440x900.mp4
  2026-10-27_1432_acme-shop_export-csv_video_1440x900.poster.png
  2026-10-27_1432_acme-shop_export-csv_video_1440x900.meta.json   (étapes horodatées, durée, poids, verdict QA)
  2026-10-27_1435_acme-shop_export-csv_shot_1440x900.png
```

**Poids** : une vidéo ne dépasse **jamais 10 Mo**, quelle que soit sa durée. H.264 CRF 28 à 15 fps, largeur plafonnée à 1280 px, sans audio, `faststart`. Une démo de 30 s pèse en général quelques centaines de Ko. Si le fichier dépasse le plafond (8 Mo par défaut, réglable jusqu'à 10 Mo, compatible avec un upload dans une PR GitHub), il est ré-encodé en 2 passes au débit qui tient. Si ça ne suffit pas, le débit, la résolution (jusqu'à 320 px) et le fps (jusqu'à 5) baissent par paliers. Si même ça ne passe pas (plusieurs heures de vidéo), `finalize` échoue plutôt que de livrer un fichier trop lourd.

## Options et variables

| `/demo` | Effet |
|---|---|
| `--video` / `--shot` | force le mode (sinon le planner choisit) |
| `--mkv` | conteneur MKV au lieu de MP4 |
| `--max-mb N` | plafond de poids de la vidéo (10 Mo au maximum) |
| `--mobile` | viewport 390×844 |
| `--headed` | navigateur visible pendant la prise |

| Variable | Défaut |
|---|---|
| `DEMO_AGENT_OUTPUT_DIR` | `~/Documents/Demos` |
| `DEMO_AGENT_MAX_MB` | `8` (plafonné à 10) |
| `DEMO_AGENT_CDP_URL` | `http://127.0.0.1:9222` |
| `DEMO_AGENT_STEP_PAUSE_MS` | `600` (pause après chaque action) |
| `DEMO_AGENT_FFMPEG` | ffmpeg-static, sinon `ffmpeg` du PATH |
| `DEMO_AGENT_CHROME`, `DEMO_AGENT_CHROME_PROFILE` | pour `chrome-debug` |

## Développement

```bash
cd mcp/demo-capture && npm test     # nommage, dossier Documents, poids, 2 passes, plafond de 10 Mo
node scripts/e2e.mjs                # navigateur lancé : enregistrement, capture, finalisation
node scripts/e2e-chrome.mjs         # onglet Chrome attaché : liste, ambiguïté, détachement
```

Outils MCP exposés : `run_storyboard` (la prise complète), `check_setup`, `list_targets`, `list_accounts`, `open_target`, `snapshot`, `navigate`, `click`, `hover`, `type`, `press`, `scroll`, `wait_for`, `login`, `start_recording`, `mark_step`, `stop_recording`, `screenshot`, `extract_frames`, `finalize`, `close_target`.
