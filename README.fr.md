# screencaster

[English](README.md) · **Français**

Plugin Claude Code qui produit, à partir d'une simple description, **une vidéo de démo légère (MP4 ou MKV)** ou **des screenshots PNG** :
- d'une fonctionnalité d'une app web (localhost, staging), avec connexion par compte de test ;
- d'un onglet déjà ouvert dans ton Chrome.

```
/screencaster filme l'export CSV que je viens d'implémenter
/screencaster screenshot de l'onglet du dashboard Stripe --shot
/screencaster parcours d'inscription en mobile --mobile --max-mb 5
```

Les fichiers vont dans **`~/Documents/Demos/<projet>/<date>/`**, sur macOS, Windows et Linux. Ils ne sont jamais écrits dans le dépôt. L'agent répond dans la langue dans laquelle tu lui écris.

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
/screencaster "<description>"                 skill orchestrateur
  ├─ target-resolver   (haiku)        quoi filmer : onglet Chrome ou URL de l'app, compte de test
  ├─ demo-planner      (sonnet)       vidéo ou screenshot, storyboard avec vrais sélecteurs, slug du nom
  ├─ capture-operator  (sonnet)       exécute le storyboard via le serveur MCP demo-capture
  ├─ media-reviewer    (sonnet)       regarde les images : fonctionnalité visible ? erreur ? secret ? coupe
  └─ finalize          (code)         compression, nom, vignette, meta.json → Documents
```

- Chaque sous-agent n'a que les outils dont il a besoin : aucun ne peut lancer de commande, écrire de fichier ni naviguer sur le web, donc une page piégée ne peut pas leur faire agir sur ta machine.
- Un sous-agent seulement là où il faut du jugement. Le nommage, la compression et le rangement sont du code : déterministes et gratuits.
- Un seul navigateur, détenu par le serveur MCP : ce qui est filmé est exactement ce qui a été piloté.
- La prise se joue d'un seul tenant côté serveur (`run_storyboard`) : pas de temps morts liés à la réflexion du modèle, et les états brefs comme un toast de 2 s sont attrapés.
- Une capture via CDP `Page.startScreencast`, identique pour un Chromium lancé et pour un onglet de ton Chrome.
- Une boucle de relecture : au plus 2 nouvelles prises si la vidéo ne montre pas la fonctionnalité.
- Un rendu de démo : faux curseur visible, effet au clic, légendes en bandeau, overlays de dev masqués (Next, Vite, devtools).

## Réseau et données

Rien n'est envoyé à l'auteur du plugin : pas de télémétrie, pas de serveur.

- **Réseau** : le navigateur charge les pages que tu demandes de filmer, avec leurs propres requêtes. `check_url` envoie un GET à ton serveur de dev pour voir s'il répond. Au premier démarrage, le plugin télécharge ses paquets npm (`npm ci`, fixés par `package-lock.json`), le binaire ffmpeg de `ffmpeg-static` depuis ses releases GitHub, et le Chromium de Playwright seulement si Chrome est absent.
- **Identifiants** : les comptes de test sont lus dans `SCREENCASTER_ACCOUNTS`, `.screencaster/accounts.json` ou un fichier `.env` du projet, et tapés seulement sur une app locale ou une origine que tu as listée (voir [Comptes de test](#comptes-de-test)). Ils ne sont jamais envoyés ailleurs, ni journalisés, ni écrits dans un fichier.
- **Stocké sur ta machine** : vidéos, captures, vignettes et `meta.json` dans `~/Documents/Demos`. Ils montrent ce qu'affiche la page filmée, données personnelles comprises. Les enregistrements bruts restent dans un dossier temporaire supprimé à l'arrêt du serveur.

## Installation (une fois par machine)

Prérequis : Node 20 ou plus, et Claude Code. ffmpeg est fourni par `ffmpeg-static`. Google Chrome est utilisé s'il est installé, sinon le Chromium de Playwright est téléchargé. Sous Linux sans Chrome, Chromium a besoin de bibliothèques système : lance une fois `sudo npx playwright install-deps chromium`.

```bash
claude plugin marketplace add vladnacht/screencaster
claude plugin install screencaster@screencaster
```

Relance Claude Code. Le serveur `demo-capture` démarre avec le plugin et s'installe tout seul au premier démarrage (quelques secondes). Le premier `/screencaster` télécharge ensuite ffmpeg, et Chromium si Chrome est absent (environ une minute). Pour tout faire d'avance, lance `node scripts/setup.mjs` depuis un clone de ce dépôt.

## Filmer un onglet de ton Chrome

Chrome n'autorise le pilotage à distance que sur un **profil dédié**. Lance-le avec :

```bash
scripts/chrome-debug.sh                                          # macOS / Linux
powershell -ExecutionPolicy Bypass -File scripts\chrome-debug.ps1   # Windows
```

`/screencaster` te donne le chemin complet du script quand il en a besoin. Le profil est gardé dans `~/.screencaster/chrome-profile` : connecte-toi une fois à tes sites dans cette fenêtre, la session est conservée. Ouvre ensuite l'onglet à filmer, puis lance `/screencaster …`. Quand l'agent se détache, l'onglet reste ouvert.

## Comptes de test

Le serveur lit les identifiants et les tape directement dans la page. Ils ne passent jamais par le modèle, les logs ou `meta.json`. Sources, par ordre de priorité :

1. Variable d'environnement `SCREENCASTER_ACCOUNTS='{"admin":{"username":"…","password":"…"}}'`
2. `<projet>/.screencaster/accounts.json` (même format ; pense à l'ajouter à `.gitignore`)
3. `~/.screencaster/accounts.json`
4. Ou des clés d'un fichier `.env` du projet (`envFile` + `userKey` + `passKey`), que le resolver repère par leur **nom**. Seul un fichier `.env*` du projet est accepté.

Les identifiants ne sont tapés que sur une app locale (`localhost`, `127.0.0.1`, `*.localhost`, `*.test`, fichiers locaux). Pour se connecter sur un staging, liste son origine avec le compte, `{"admin": {"username": "…", "password": "…", "origins": ["https://staging.acme.com"]}}`, ou dans `SCREENCASTER_LOGIN_ORIGINS` (séparées par des virgules). L'agent ne les tape jamais sur une autre page.

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

| `/screencaster` | Effet |
|---|---|
| `--video` / `--shot` | force le mode (sinon le planner choisit) |
| `--mkv` | conteneur MKV au lieu de MP4 |
| `--max-mb N` | plafond de poids de la vidéo (10 Mo au maximum) |
| `--mobile` | viewport 390×844 |
| `--headed` | navigateur visible pendant la prise |

| Variable | Défaut |
|---|---|
| `SCREENCASTER_OUTPUT_DIR` | `~/Documents/Demos` |
| `SCREENCASTER_MAX_MB` | `8` (plafonné à 10) |
| `SCREENCASTER_CDP_URL` | `http://127.0.0.1:9222` |
| `SCREENCASTER_STEP_PAUSE_MS` | `600` (pause après chaque action) |
| `SCREENCASTER_FFMPEG` | ffmpeg-static, sinon `ffmpeg` du PATH |
| `SCREENCASTER_LOGIN_ORIGINS` | aucune : origines, en plus des locales, où les comptes de test peuvent être tapés |
| `SCREENCASTER_CHROME`, `SCREENCASTER_CHROME_PROFILE` | pour `chrome-debug` |

## Développement

```bash
node scripts/setup.mjs              # installation, build, ffmpeg, navigateur
cd mcp/demo-capture && npm test     # nommage, dossier Documents, poids, 2 passes, plafond de 10 Mo
node scripts/e2e.mjs                # navigateur lancé : enregistrement, capture, finalisation
node scripts/e2e-chrome.mjs         # onglet Chrome attaché : liste, ambiguïté, détachement
```

La CI lance tout cela sous Linux, macOS et Windows, plus un job Linux sans Chrome.

Outils MCP exposés : `run_storyboard` (la prise complète), `check_setup`, `list_targets`, `list_accounts`, `open_target`, `snapshot`, `navigate`, `click`, `hover`, `type`, `press`, `scroll`, `wait_for`, `login`, `start_recording`, `mark_step`, `stop_recording`, `screenshot`, `extract_frames`, `finalize`, `close_target`.

## Licence

MIT
