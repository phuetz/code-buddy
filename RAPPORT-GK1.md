# RAPPORT GK1 — Cowork installé et utilisé par un inconnu sous Linux

Date : 2026-09-03  
Agent : Grok 4.6  
Clone : `/home/patrice/DEV/cb-never-cowork-2026-09-02`  
Branche : `fix/gk1-cowork-inconnu-2026-09-03`  
Base : `3fcf5a97d` (`docs(voice): consigner les preuves DARK3`)  
HEAD produit : `5b5330c8f`

Ce rapport a été créé **avant** la lecture des cinq documents autorisés, puis complété au fil de l'eau.

## Contraintes respectées

- Clone uniquement. Original `~/code-buddy` non touché.
- Aucun `git push`, `git prune`, `git reset --hard`, `rm -rf`, `git add -A`, `git commit -a`.
- Aucune API payante. Ollama local `qwen3:4b-instruct` sur `127.0.0.1:11434`.
- Aucun service systemd. ComfyUI 8188/8189, `buddy` 3000/3001 laissés en place.
- HOME isolé : `_gk1/home` (gitignoré). Jamais `~/.codebuddy`.
- Jamais `DISPLAY=:10` pour Electron (xvfb-run a attribué `:104` puis un autre écran).
- Ports déjà pris non réutilisés (CDP 9222 occupé → 9334 puis 9341).

## Docs suivies (uniquement)

`README.md`, `docs/getting-started.md`, `cowork/README.md` (alors `readme.md`), `cowork/DEV-LINUX.md`, `cowork/ARCHITECTURE.md`.

Parcours Linux documenté (DEV-LINUX + getting-started) :

```
npm install
(cd cowork && npm install)
npx tsc -p .
(cd cowork && npm run rebuild)
cd cowork && npx vite build
xvfb-run -a NODE_ENV=production ./node_modules/electron/dist/electron \
  --no-sandbox --disable-gpu ./dist-electron/main/index.js
```

## Journal

### 0. Ouverture

- Branche propre à `3fcf5a97d`.
- `cowork/README.md` **absent** (`cowork/readme.md` en minuscules).
- `node_modules` racine et `cowork/node_modules` absents (copie propre).
- Node `v24.14.1`, npm `11.17.0`, `xvfb-run` présent.
- Ollama : `qwen3:4b-instruct` et `qwen3.8:27b` listés.
- DISPLAY hôte `:10.0` — jamais transmis à Electron.

### 1. Installation

```
HOME=_gk1/home  npm install
# added 1848 packages, 1m, exit 0  (11:12:23 → 11:13:36)

(cd cowork && npm install)
# postinstall: download Node v22.22.0 linux-x64 + electron-rebuild
# added 1371 packages, 28s, exit 0
# npm warn allow-scripts 9 packages (electron postinstall déjà exécuté : binaire présent)

npx tsc -p .
# exit 0, ~59 s, dist/desktop/codebuddy-engine-adapter.js présent

(cd cowork && npm run rebuild)
# Rebuild Complete, exit 0

(cd cowork && npx vite build)
# exit 0, ~28 s, dist-electron/main/index.js + dist/index.html
```

Écart doc : `cowork npm install` télécharge déjà un Node standalone (postinstall `download-node.js`), alors que DEV-LINUX présente ce téléchargement comme le défaut du packager `npm run build`. Ça n'a pas bloqué (réseau OK). Non corrigé : comportement utile, la doc sous-estime le coût de `npm install`.

### 2. Lancement Electron (xvfb)

```
unset DISPLAY
xvfb-run -a --server-args="-screen 0 1400x900x24" \
  env NODE_ENV=production HOME=_gk1/home \
  ./node_modules/electron/dist/electron \
    --no-sandbox --disable-gpu --enable-logging \
    --remote-debugging-port=9334 \
    ./dist-electron/main/index.js
```

- CDP OK en 3 s. `DISPLAY=:104` (pas `:10`).
- Log : `[Runtime] Using Code Buddy engine (embedded)`.
- NavServer : 19888 pris → écoute 19889.
- Premier écran : assistant « Welcome to Code Buddy Studio / Step 1 of 5 ».
- Titlebar déjà `openrouter/free` avant toute config.

### 3. Assistant + Ollama

- **Quick start** ouvre l'étape fournisseur (conforme aux captures getting-started).
- **Full control** saute l'étape fournisseur (step 3 workspace). Doc désormais explicite.
- Clic **Local runtimes** → modal « Set Up API » encore piné **OpenRouter / Needs key**.
  Preuve : `_gk1/shots/06-local-runtimes.png` / `08-config-modal.png`.
- Clic manuel **Ollama** → modèles découverts, `qwen3:4b-instruct` sauvé, titlebar `qwen3:4b-instruct`.
- Sauver le fournisseur **fermait le wizard** (`isConfigured`) avant le dossier de travail.

### 4. Premier chat — VERT

Prompt : `Réponds en une seule phrase courte : que peux-tu faire ?`

Réponse réelle Ollama (`qwen3:4b-instruct`, 12,8 s, `$0.0000`) :

> Je peux éditer des fichiers, exécuter des commandes, rechercher du contenu et tester des applications web.

Capture : `_gk1/shots/19-chat-state.png`.

### 5. Fichier créé par l'agent — ROUGE (cause racine)

Prompt : créer `hello-gk1.md` avec `Bonjour GK1`.

Réponse :

> I cannot create files outside the workspace. Please specify a path within the allowed workspace.

Cwd affiché : `…/_gk1/home/.config/Electron/default_working_dir`.

Causes empilées :

1. Wizard fermé dès `isConfigured` → pas de **Choose a folder…**.
2. Même après `config.save({ defaultWorkdir })`, le prochain chat restait sur `default_working_dir` (pas de `workdir.set`).
3. Le picker d'accueil n'envoyait que `defaultWorkdir`.

Aucun `hello-gk1.md` n'a été produit. Correctifs 2 et 5 ci-dessous.

### 6. Bibliothèque de médias — VERT (vide)

Rail **Library** → vue `Bibliothèque` / « Images et vidéos générées », 0 média. Attendu : aucun média généré. Capture `_gk1/shots/30-store-driven.png`. Absent des 5 docs avant le correctif documentaire.

### 7. Redémarrage : l'historique est là — VERT

Relaunch xvfb, même HOME `_gk1/home` :

- Session persistée `What can you do？` (id `55d939d7-…`).
- Briefing : « 1 session mise à jour ».
- Après `setActiveSession`, 4 messages rechargés (1er chat + tentative d'écriture).

Capture `_gk1/shots/25-history.png`.

## Écarts, tests, correctifs, commits

| # | Écart | Test rouge | Correctif | Commit |
|---|---|---|---|---|
| 1 | Local runtimes ouvre OpenRouter (clé requise) | `onboarding-brain-cards.test.ts` « Local runtimes opens API settings on Ollama » (échoué, puis 15/15) | Hint `providerHint: 'ollama'` → `ConfigModal.preferredProvider` | `b79d5e79e` |
| 2 | Sauver Ollama ferme le wizard avant le workspace | `onboarding-wizard-stays-until-complete.test.ts` (échoué, puis vert) | `setShowOnboarding(!config.onboardingCompleted)` | `d29ff7db5` |
| 3 | `cowork/README.md` absent sur Linux (`readme.md`) | `linux-readme-path.test.ts` (échoué, puis vert) | `git mv cowork/readme.md cowork/README.md` + liens | `0f505045a` |
| 4 | Liens cassés `docs/dev-linux.md` / `architecture.md` ; Quick start / Library / workspace non dits | `linux-doc-links.test.ts` | Liens + getting-started + README Quick start | `568c53fa5` |
| 5 | Dossier d'accueil non appliqué au prochain chat | `welcome-project-selector.test.ts` « live workdir » | `workdir.set` après le picker | `5b5330c8f` |

Autres commits de chantier : `8b7a6434b` (rapport + FABLE5), `9310a7e22` (`_gk1/` gitignoré).

## Tableau exigé — étape → durée → écart → correctif → commit

| Étape | Durée | Écart | Correctif | Commit |
|---|---|---|---|---|
| npm install racine | 73 s | warnings peer/allow-scripts, 48 CVE lockfile | aucun (install exit 0) | — |
| npm install cowork | 28 s | postinstall télécharge Node (doc le met sur `npm run build`) | doc non changée (réseau OK) | — |
| `npx tsc -p .` | 59 s | aucun | — | — |
| `npx vite build` | 28 s | aucun | — | — |
| Electron xvfb | 3 s jusqu'au CDP | titlebar OpenRouter avant config | hint Local runtimes | `b79d5e79e` |
| Assistant Quick start | ~2 min | Local runtimes → OpenRouter ; Full control saute le fournisseur | hint Ollama + doc Quick start | `b79d5e79e`, `568c53fa5` |
| Sauver Ollama | ~40 s | wizard disparaît | rester jusqu'à `onboardingCompleted` | `d29ff7db5` |
| Premier chat Ollama | 12,8 s | aucun | — | — |
| Fichier agent | 43 s puis refus | cwd hors sandbox ; picker inerte | wizard + `workdir.set` | `d29ff7db5`, `5b5330c8f` |
| Bibliothèque | ~2 s | non documentée | phrase README Quick start | `568c53fa5` |
| Redémarrage historique | 26 s boot | overlay History intercepte les clics Playwright (pas un inconnu souris) | aucun produit | — |

## Ce qui empêche encore un inconnu d'y arriver seul

1. **Il doit choisir Quick start**, pas Full control, pour voir l'étape fournisseur (maintenant écrit dans getting-started).
2. **Il doit cliquer Ollama dans Settings** si un build antérieur au hint est en main — corrigé dans cette branche.
3. **Il doit choisir un dossier** (dialogue natif, session graphique). Sans ça, le cwd Electron `default_working_dir` n'est pas le sandbox d'écriture. Corrigé : le wizard reste, le picker pose `workdir.set`. En headless/xvfb le dialogue GTK n'est pas pilotable au clavier documenté.
4. **`qwen3:4b-instruct` chatte** mais rate souvent l'outil d'écriture (contexte déjà à 50 % au premier tour). Un inconnu avec seulement ce petit modèle peut rester bloqué sur « create a file ». `qwen3.8:27b` est autorisé mais plus lent ; non rejoué ici.
5. **Port 3000 déjà pris** (serveur existant). L'app a basculé NavServer. Un inconnu qui lance `buddy gui` *et* a déjà `buddy server` verra l'avertissement DEV-LINUX.
6. **`cowork npm install`** télécharge un Node ~30 Mo. Hors ligne = mur, non dit clairement.

## Vérifications finales

```
cd cowork && npx tsc --noEmit -p .     # TSC=0
npx eslint <9 fichiers touchés> --max-warnings=0   # ESLINT=0
npx vitest run tests/onboarding-brain-cards.test.ts \
  tests/onboarding-wizard-stays-until-complete.test.ts \
  tests/linux-readme-path.test.ts tests/linux-doc-links.test.ts \
  tests/welcome-project-selector.test.ts \
  tests/onboarding-wizard-practicality.test.ts \
  tests/onboarding-permission-cards.test.ts \
  tests/onboarding-shell-coexistence.test.ts
# Test Files  8 passed (8)
# Tests  20 passed (20)
```

Racine : `npx vitest run tests/docs/cowork-public-docs-privacy.test.ts` → 13/13 (après le rename README).

Aucun push. Aucune API payante. HOME réel et `~/code-buddy` intacts.
