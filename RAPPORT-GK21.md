# RAPPORT GK21 — Les outils navigateur de Code Buddy (`app_server`, `web_test`, `computer_control`) en vrai sur une appli locale

Date : 2026-09-03
Agent : Grok 4.6
Clone : `/home/patrice/DEV/cb-repar-jumeaux-b-2026-09-02`
Branche : `fix/gk21-web-test-reel-2026-09-03`
HEAD au démarrage : `2cb4bb7b5`
Original `~/code-buddy` : interdit (jamais ouvert, jamais écrit)
Rapport créé **avant toute inspection** du code `app_server` / `web_test` / `computer_control` / `dev-origins`.

## Mission

Éprouver en vrai, sur `_qa/gk21-app/`, les outils navigateur de Code Buddy. Loi : « se servir de ses applis EN VRAI ». Navigateur Playwright headless uniquement (jamais `DISPLAY=:10`, jamais le Brave de Patrice sur `:9222`). HOME temporaire `_qa/gk21/home`. Ollama local seulement.

## Garde-fous tenus

- Aucun `git push` / `prune` / `reset --hard` / `rm -rf` / `git add -A` / `git commit -a`.
- Aucune API payante. ComfyUI 8188/8189 non touché. Port 8000 (uvicorn, pas OmniParser) non appelé.
- `PLAYWRIGHT_BROWSERS_PATH=/home/patrice/.cache/ms-playwright` (cache déjà présent, pas de téléchargement). Chromium headless Playwright, pas Brave.
- HOME = `_qa/gk21/home` dans le clone.

## Fichiers lus

- `CLAUDE.md` (§ `CODEBUDDY_BROWSER_DEV_ORIGINS`, `app_server`, `web_test`, OmniParser)
- `src/security/dev-origins.ts`
- `src/tools/app-server-tool.ts`, `src/tools/registry/process-tools.ts` (`AppServerExecuteTool`)
- `src/tools/registry/web-test-tool.ts`
- `src/browser-automation/browser-tool.ts`, `browser-manager.ts`
- `src/tools/computer-control-tool.ts`, `src/desktop-automation/omniparser-runner.ts`, `smart-snapshot.ts`
- `src/tools/screenshot-tool.ts`
- Tests existants : `tests/tools/app-server-real.test.ts`, `web-test-real.test.ts`, `web-test-steps-real.test.ts`, `web-test-network-real.test.ts`, `tests/security/dev-origins.test.ts`, `tests/desktop-automation/omniparser-runner.test.ts`

## Journal

| Heure | Action |
|---|---|
| Démarrage | Rapport + réservation Fable 5. Commit `7bef957ec`. |
| Inspection | Sources ci-dessus. |
| Lot 1 | `web_test` PASSED sans capture. Rouge collé, correctif, vert. `55ba7286c`. |
| Lot 2 | OmniParser silencieux. Rouge collé, no-op honnête, vert. `2bb1dbc58`. |
| Lot 3 | Captures dans `/tmp`. Mini-appli + test réel. `80056a14a`. |
| Lot 4 | Origine non loopback : `logger.warn` déjà là ; test de preuve. `27ba115dc`. |
| Lot 5 | Snapshot sans DISPLAY énumérait AT-SPI (Chromium du session). Skip honnête. `94c35e701`. |
| Lot 6 | `CODEBUDDY_MAX_CONTEXT=16384` vidait le system prompt (budget 0). `3d1b0daa5`. |
| Live tools | `_qa/gk21/run-tools.ts` : occupied refused, home FAILED (console), about PASSED, OmniParser `not-requested`, 0 élément AT-SPI. |
| Agent Ollama | 4b : `app_server stop` pid `12345` fantôme. 27b : bloqué ~15 min (contexte 262k / GPU occupé). Relance 4b tuée après 5 min sans jeton. |

## Mini appli

`_qa/gk21-app/` — serveur Node unique (`server.mjs`), `PORT` obligatoire, bind `127.0.0.1`.

- `/` formulaire `#greet-form`, `console.error('GK21 voluntary console error')`, bouton `#nav-about`.
- `/about.html` page d’arrivée.
- `/greet?name=` réponse Hello.

Preuves visuelles : `_qa/gk21/proofs/home-console-error.png`, `_qa/gk21/proofs/about-after-navigate.png`.

## Écarts

### E1 — `web_test` PASSED sans capture — FERMÉ (`55ba7286c`)

Si `browser screenshot` échouait, les assertions pouvaient quand même produire `PASSED`.

- Rouge : `tests/tools/gk21-web-test-screenshot-missing.test.ts` (`passed === true`).
- Correctif : check `screenshot` obligatoire (sauf `screenshot: false`).
- Vert : 1/1.

### E2 — OmniParser silencieux — FERMÉ (`2bb1dbc58`)

`snapshot_with_screenshot` + `useOmniParser` sans capture / serveur mort : succès sans mot. Le défaut `:8000` (uvicorn, pas OmniParser) n’est plus contacté (URL de test `127.0.0.1:59991`).

- Rouge : output sans `OmniParser`.
- Correctif : `data.omniParser` = `applied` / `unavailable` / `skipped` / `not-requested` + notes dans le rapport.
- Vert : 3/3.

### E3 — Captures dans `/tmp` — FERMÉ (`80056a14a`)

Playwright écrivait `/tmp/codebuddy-screenshots/…`.

- Rouge : `expected not to match /^\/tmp/`.
- Correctif : `$HOME/.codebuddy/browser-screenshots` ou `CODEBUDDY_SCREENSHOT_DIR`.
- Vert : live mini-appli, chemin sous `_qa/gk21/home`.

### E4 — Origine non loopback — DÉJÀ CONFORME (`27ba115dc`)

`CODEBUDDY_BROWSER_DEV_ORIGINS=http://localhost:5173, http://192.168.1.20:3000, https://example.com` : warn + seul le loopback enregistré. Test de preuve 1/1.

### E5 — AT-SPI sans DISPLAY — FERMÉ (`94c35e701`)

Live `run-tools.ts` (avant correctif) : 34 éléments session (« Chromium Web Browser », menus Nautilus) alors que `DISPLAY` était unset. Capture écran : `Can't open display` / `xdpyinfo`.

- Rouge observé dans `_qa/gk21/artifacts/run-tools.json` (non suivi).
- Correctif : pas d’AT-SPI ni scrot/`xdpyinfo` sans `DISPLAY`/`WAYLAND_DISPLAY`. Snapshot vide + « Screenshot not captured (honest no-op) ».
- Vert : `gk21-computer-control-headless-display` 1/1. Rejeu live : `elementCount=0`, `omniParser=not-requested`.

### E6 — System prompt vidé — FERMÉ (`3d1b0daa5`)

`CODEBUDDY_MAX_CONTEXT=16384` + `qwen3.8:27b` (`maxOutputTokens=16384`) → `budget: 0 tokens` → prompt de 201081 caractères tronqué à 0. Agent muet.

- Rouge : log agent `chars → 0`.
- Correctif : si `maxOutput >= contextWindow`, budget = 25 % de la fenêtre (plancher 256 jetons).
- Vert : `tests/services/prompt-builder.test.ts` 41/41.

## Tableau final

| Scénario | Attendu | Obtenu | Correctif | Commit |
|---|---|---|---|---|
| `app_server` port libre | Serveur prêt, origine enregistrée | `Dev server ready (pid …)` origin `http://127.0.0.1:46617` | — (déjà) | preuve live |
| Port occupé | Refus, pas d’adoption | `Port 44531 … already in use. app_server refuses to adopt` | — (déjà) | test + live |
| `web_test` home (console.error) | FAILED + erreur console + logs + capture | FAILED, `GK21 voluntary console error`, `Server logs`, PNG | E1 capture manquante | `55ba7286c` |
| `web_test` click `#nav-about` | PASSED about + capture | PASSED, title About GK21, PNG | E3 hors `/tmp` | `80056a14a` |
| Origine `192.168` / `example.com` | Rejet bruyant | `logger.warn` + non enregistré | test de preuve | `27ba115dc` |
| `computer_control` sans OmniParser | No-op honnête | `omniParser=not-requested`, screenshot null | E2 | `2bb1dbc58` |
| Snapshot sans DISPLAY | Ne pas scraper le bureau | Avant : 34 éléments session. Après : 0 élément, pas de scrot | E5 | `94c35e701` |
| Agent Ollama 4b | `app_server` start + `web_test` | `stop` pid **12345** ; résumé halluciné | non corrigé (modèle) | — |
| Agent Ollama 27b | idem, outils complets | Bloqué ~15 min, 0 outil (KV 262k / GPU partagé) | E6 budget 0 si MAX_CONTEXT=maxOutput | `3d1b0daa5` |

## Preuves commandes

Union ciblée GK21 (DISPLAY unset) :

```
env -u DISPLAY -u WAYLAND_DISPLAY LOG_LEVEL=error ./node_modules/.bin/vitest run \
  tests/tools/gk21-web-test-screenshot-missing.test.ts \
  tests/tools/gk21-computer-control-omniparser-noop.test.ts \
  tests/tools/gk21-computer-control-headless-display.test.ts \
  tests/tools/gk21-web-test-reel.test.ts \
  tests/security/gk21-dev-origins-loud.test.ts \
  tests/security/dev-origins.test.ts
```

**13/13 verts**, 6 fichiers, 8,83 s.

Voisins `RUN_REAL_TESTS=1` : `web-test-real` + `web-test-steps-real` + `web-test-network-real` + `app-server-real` → **12/12 verts**.

`npx tsc --noEmit -p tsconfig.json` exit 0.

ESLint ciblé `--max-warnings=0` sur les fichiers touchés : exit 0.

Live tools (`tsx _qa/gk21/run-tools.ts`, HOME clone, DISPLAY unset) :

```
occupiedRefused: true
homePassed: false
aboutPassed: true
omniParser: not-requested
```

Rapport home (extrait) :

```
Web test FAILED — http://127.0.0.1:46617/
✗ console: 2 error(s): GK21 voluntary console error | GK21 voluntary console error
✓ screenshot: …/_qa/gk21/artifacts/screenshot-….png
Server logs (app_server):
GK21 listening on http://127.0.0.1:46617/
GK21 hit GET /
```

## Agent headless (Ollama) — PARTIEL

- `qwen3:4b-instruct` (63 s) : un seul appel `app_server stop` avec pid `12345`. Le glob `qwen3*` **désactive** `computer_control` et `browser` (`src/config/model-tools.ts`). Résumé final inventé.
- `qwen3.8:27b` : prompt 128k, Ollama `-c 262144`, aucun outil en 15 min (GPU partagé avec d’autres jobs). Tué.
- Relance `CODEBUDDY_MAX_CONTEXT=16384` : budget 0 (E6) puis correctif. Relance 4b suivante : plus de jeton (Ollama saturé). Tuée.

Les outils eux-mêmes sont prouvés par le driver `run-tools.ts` et les tests Vitest (même code que l’agent).

## Reste ouvert / HUMAIN

- Parcours agent 27b sur GPU libre, avec `CODEBUDDY_MAX_CONTEXT` > `maxOutputTokens` (après E6).
- `qwen3*` continue de désactiver `computer_control` / `browser` : un 4b ne peut pas faire le parcours complet même s’il appelle les bons outils.
- `getMockElements()` (faux bouton OK) reste le repli AT-SPI quand un DISPLAY existe mais que python-gi manque — hors GK21 headless.
- Ne pas fusionner sans relire : `computer_control` ne scrape plus la session sans DISPLAY (changement de comportement voulu).
