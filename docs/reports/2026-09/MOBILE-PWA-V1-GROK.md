# MOBILE-PWA-V1-GROK — PWA mobile Code Buddy : prototype vibe → v1 réelle

Date : 2026-09-06 (Europe/Paris)
Agent : Grok 4.6
Clone : `~/DEV/cb-mobile-2026-09-06`
Branche : `feat/mobile-pwa-2026-09-06`
HEAD au départ : `c74b8f22b` (`docs(audit): add verification report for mobile PWA prototype`)
Original `~/code-buddy` : interdit
Rapport créé **avant toute écriture de code** (ce fichier, commité).
HOME temporaire : `_qa/grok/home`. Aucune écriture dans le vrai `~/.codebuddy`.
Cahier : `docs/reports/2026-09/VERIF-MOBILE-AGY.md` (10 trous) + `MOBILE-PWA-VIBE.md`.
Inspiration imposée : projet Lisa (`~/DEV/Lisa`, public `https://github.com/phuetz/Lisa`).

## Mission

Fermer les 10 trous d'agy. Le serveur doit démarrer. Preuves collées. Pas de verdict.

Ordre :

1. **P1.1 / P1.2 / P1.3 / P7** — Express 5, copie d'assets au `npm run build`, icônes PNG 96/192/512 générées par script, `tests/server` à 0 rouge.
2. **P2** — client WS sur le protocole réel de `src/server/websocket/handler.ts` + essai Ollama streamé.
3. **P4** — `confirmation_required` / `confirmation_response` branchés sur `ConfirmationService` (fail-closed, une réponse par id, JWT).
4. **P5** — `/api/runs` + `/api/runs/:id/trajectory` (`buildTrajectory` est dans cette base) + statut fournisseur / repli / flotte.
5. **P3** — sélecteur Agent / Lisa / Pairs réellement câblé, sinon retiré.
6. **P6** — CSP sans `unsafe-eval` ni `unsafe-inline`.
7. **P8** — hors v1 : lister ce qu'il faudrait (mission → lane → sentinelle) pour Astra.

## Garde-fous

- Aucun `git push`, `git prune`, `git reset --hard`, `rm -rf`, `git add -A`, `git commit -a`.
- Vitest : `HOME=~/DEV/cb-mobile-2026-09-06/_qa/grok/home` et `env -u FORCE_COLOR`.
- Ports de test ≥ 3460. ComfyUI 8188/8189 non touché.
- Jamais `/home/<user>` ni prénom ni secret dans les fichiers suivis.

## Journal

### 2026-09-06 — création du rapport (avant code)

HEAD `c74b8f22b`. Branche déjà extraite (prototype vibe 4 commits + rapport agy).
Rapports lus : `VERIF-MOBILE-AGY.md`, `MOBILE-PWA-VIBE.md`.
`buildTrajectory` est dans cette base (`2be0d27c2` sur `src/observability/run-trajectory.ts`).

### Décision Lisa (lecture avant d'écrire la v1)

Lu : `README.md`, `CLAUDE.md`, `package.json`, `apps/mobile/package.json`, `packages/ui-kit`, `packages/markdown-renderer`, `packages/audio-engine` (Web Speech), `src/hooks/useMcpClient.ts`, `src/theme/colors.ts`, `src/components/chat/ChatLayoutMobile.tsx`, `src/components/mobile/MessageBubble.tsx`.

**Choix : garder la PWA vanilla sous `/__codebuddy__/mobile/`, sans importer le client Lisa.**

Justification :

| Critère | Client Lisa (a) | Vanilla (b) |
|---|---|---|
| Pile | React 19 + Vite 6 + MUI 7 + Capacitor 8 + Tauri + TensorFlow + MediaPipe | HTML/CSS/JS, zéro bundler |
| `apps/mobile` | Wrapper Capacitor du web complet (`web-dir ../web/dist`) | — |
| `@lisa-sdk/ui` | peer MUI + lucide-react | — |
| `@lisa-sdk/markdown` | peer React + `react-markdown` + prismjs | — |
| `useMcpClient` | 25 lignes, list/read MCP, pas un chat | — |
| Bundle | largement > 10 Mo (vision/audio/3D) | quelques dizaines de Ko |
| Licence / auteur | même auteur, réutilisation légitime | — |

La mission impose l'architecture `route /__codebuddy__/mobile/` + PWA vanilla sans CDN + pas de bundle de 10 Mo pour un chat. Copier le client Lisa (ou une dépendance workspace vers `~/DEV/Lisa`) tirerait React/MUI/Capacitor et couplerait Code Buddy à la perception navigateur. Ce n'est pas un chat.

**Réutilisation ciblée, sans copie de paquets :**

- Jetons visuels Lisa (`src/theme/colors.ts`) : fond `#0a0a0f`, surface `#12121a`, accent ambre `#f5a623`, cyan `#06b6d4`, texte `#e8e8f0`.
- UX : bulles, double-tap copier, barre basse, saisie vocale Web Speech API (même idée que `packages/audio-engine/src/service.ts`).
- Markdown : rendu local assaini (pas `react-markdown`).

Pas de copie de fichiers Lisa dans `src/server/mobile/` (trop couplés à React). Pas de workspace vers le dépôt Lisa (cycle de build, monorepo pnpm, deps natives).

### Inspection des 10 trous (après réservation)

Constat agy relu sur le code :

- P1.1 : `mobilePwaRouter.get('/assets/*')` — Express 5 / `path-to-regexp` v8 refuse le joker anonyme.
- P1.2 : `npm run build` = `tsc` + `copy-bundled-skills` + `write-runtime-manifest`. Canvas/A2UI n'ont pas de copie : le HTML est inline. Les skills passent par `scripts/copy-bundled-skills.mjs`. Même patron pour la PWA.
- P1.3 : manifeste cite `icon-96.png` / `icon-192.png` ; seul `icon.svg` est présent.
- P2 : le handler émet `authenticated`, `stream_start`, `stream_chunk` (`payload.delta`), `stream_end`, `stream_stopped`, `chat_response` (`payload.content`), `pong`. Le prototype écoutait d'autres types.
- P3 : `selectAssistant` ne change qu'un libellé.
- P4 : aucun `confirmation` dans le handler WS. `ConfirmationService` a déjà `interactiveBridge` / `mcpApprovalBridge`.
- P5 : `RunStore.listRuns` + `loadTrajectory` / `buildTrajectory` existent ; pas de route HTTP. `provider-health.json` n'existe pas dans le dépôt — repli = chaîne `fallback-chain` + fichier optionnel `~/.codebuddy/provider-health.json` s'il est présent.
- P6 : CSP avec `unsafe-eval` + `unsafe-inline` (enregistrement SW inline).
- P7 : 18 suites / 40 tests rouges par crash d'import. Le test PWA utilise `http.get` comme s'il renvoyait une `IncomingMessage`.
- P8 : hors v1, documenté en fin de rapport.

## Commits

| Commit | Sujet |
|---|---|
| `a6fb580d2` | stub de ce rapport + réservation + gitignore QA |
| `91d4371b5` | P1.1/P1.2/P1.3/P7 Express 5, PNG, copie build |
| `1f5507942` | P2/P3/P4 WS confirmations + companion/peer |
| `d23f2b245` | P5 `/api/runs` trajectory statut pairs |
| `753a0b19a` | client vanilla protocole réel, look Lisa, CSP |
| `9cc9a2c09` | coquille PWA montée avant le JWT (sinon 401 navigateur) |

## Preuves

### tests/server (0 rouge)

```
env -u FORCE_COLOR HOME=~/DEV/cb-mobile-2026-09-06/_qa/grok/home npx vitest run tests/server
Test Files  65 passed | 2 skipped (67)
     Tests  588 passed | 2 skipped (590)
```

Ignorés : Chromium CIFIX2 (binaire absent sous HOME QA) ; `mobile-ws-live` (gate `RUN_MOBILE_LIVE=1`). Nouveaux : confirmation 4, protocole 4, runs/statut 3, PWA 21.

### Intégration WS (mock agent)

`tests/server/mobile-ws-protocol.test.ts` : `authenticated` → `stream_start` / `stream_chunk` (`payload.delta`) / `stream_end` ; `assistant:'companion'` → `lisa:salut` ; `peer.chat` via registre → `peer:hi` ; `ping` → `pong`.

### Confirmations

`tests/server/mobile-confirmation.test.ts` : JWT + `forcePrompt` → `confirmation_required {id,tool,summary,risk}` → `confirmation_response {id, approved:true}` ; timeout 200 ms = refus ; 2ᵉ réponse `ALREADY_ANSWERED`/`UNKNOWN_CONFIRMATION` ; sans JWT = `UNAUTHORIZED`. `confirmation_response` est en `bypassLane`.

### Runs / statut

`tests/server/mobile-runs-status.test.ts` : `GET /api/runs` liste un `RunStore.startRun` ; `GET /api/runs/:id/trajectory` passe par `loadTrajectory`/`buildTrajectory` ; 404 si id inconnu ; `GET /api/status` + `GET /api/fleet/peers` voient un pair de registre.

`buildTrajectory` est dans cette base (`2be0d27c2`, `src/observability/run-trajectory.ts`). `provider-health.json` n'existe pas dans le dépôt : lu en option sous `~/.codebuddy/provider-health.json` (repli `null`) + `fallback-chain.getAllHealthStatus()`.

### tsc / eslint / diff-check / privacy

```
npx tsc --noEmit -p .          # exit 0
npx eslint --max-warnings=0    # fichiers touchés, exit 0
git diff --check               # vide, exit 0
npx vitest run tests/security/donnees-personnelles.test.ts
Test Files  1 passed (1)
     Tests  40 passed (40)
```

### Build

```
npm run build
copy-mobile-pwa-assets: src/server/mobile/assets → dist/server/mobile/assets
icon-96.png  389  89504e470d0a1a0a
icon-192.png 908  89504e470d0a1a0a
icon-512.png 2866 89504e470d0a1a0a
```

### Essai réel `node dist/index.js server --port 3461`

HOME `_qa/grok/home`, `--host 127.0.0.1`, `CODEBUDDY_PROVIDER=ollama`, `OLLAMA_HOST=http://127.0.0.1:11435`, `GROK_MODEL=qwen3.8-ctx32k:latest`. JWT de test en mémoire, pas dans le dépôt.

```
GET /__codebuddy__/mobile/          200 text/html
CSP  default-src 'self'; script-src 'self'; style-src 'self'; … connect-src 'self' ws: wss:
     (pas de unsafe-eval, pas de unsafe-inline)
GET /__codebuddy__/mobile/manifest.webmanifest  200 application/manifest+json
     start_url /__codebuddy__/mobile/  icons 96/192/512
GET /__codebuddy__/mobile/sw.js     200  Service-Worker-Allowed: /__codebuddy__/mobile/
GET /__codebuddy__/mobile/assets/icon-192.png  200 size=908
GET /__codebuddy__/mobile/health    {"ok":true,"service":"mobile-pwa"}
GET /api/status  (Bearer)  provider.id=ollama model=qwen3.8-ctx32k:latest
                           providerHealthFile=null fallback=[] peers=[]
GET /api/runs    (Bearer)  {"runs":[]}
GET /api/runs    (sans JWT) 401
```

WS (protocole réel) vers ce serveur, modèle demandé `qwen3.8-ctx32k:latest` (27,3 B, ~18 Go, déjà en VRAM avec `qwen3:4b-instruct`) :

```
connected  methods incluent chat, stop, ping, confirmation_response
authenticated  userId=mobile-user scopes=[chat]
stream_start
error HANDLER_ERROR  Task timed out after 120000ms   (file d'attente WS, 0 chunk)
```

Un generate Ollama direct (`num_predict: 8`) sur le même modèle a aussi fait timeout 90 s / 0 octet. La file WS coupe à 120 s : ce n'est pas un faux protocole.

Reprise streamée, même client, port 3462, `GROK_MODEL=qwen3:4b-instruct` (déjà chargé, 4 B) :

```
connected
authenticated  {"userId":"mobile-user","scopes":["chat"]}
stream_start   id=msg_1788689977022
stream_chunk   {"delta":"OK"}
stream_chunk   {"delta":" MO"}
stream_chunk   {"delta":"BILE"}
stream_end
--- text ---
OK MOBILE
```

Ports 3461/3462 refermés après l'essai. 8188/8189 non touchés.

## P8 — hors v1 (pilotage de flotte pour Astra)

La v1 pilote un chat (agent / Lisa / pair `peer.chat`) + confirmations + lecture de runs. Elle ne pilote pas la flotte. Pour Astra il faudrait, dans cet ordre :

1. **Mission** — un formulaire « objectif + plafond tours/coût » qui crée un run (`buddy goal` / `buddy run` / POST run), pas seulement un tour de chat. Aujourd'hui `GET /api/runs` est en lecture.
2. **Lane** — une vue des files `ThreadDelegation` (`/batch`, `/swarm`, `/team`) : agent, statut, tour, coût, flux étiqueté. Rien de ça n'est exposé en HTTP.
3. **Sentinelle** — présence stale, `utilization` (`CODEBUDDY_FLEET_MAX_CONCURRENCY`), autonomous tick, runaway, heartbeat. `/api/status.fleet` n'a que connexions WS + registre de listeners.
4. **Assignation** — `route_peer` / `peer.dispatch` avec contraintes (coût, local-only, privacy lint). Le sélecteur v1 envoie `peer.chat` au pair choisi, sans plan de dispatch.
5. **Trajectoire** — `buildTrajectory` est prêt ; l'UI v1 dump le JSON. Astra aurait besoin d'une timeline outils/permissions/coût.
6. **Ack** — le pont `confirmation_required` v1 est la brique ; il faudrait le lier aux délégations de lane (un id par enfant, pas un prompt global).

Sans ces six pièces, le téléphone reste un client de conversation, pas un poste de commandement.

## Bilan

PWA vanilla sous `/__codebuddy__/mobile/` (Lisa lu, pas importé : React/MUI/Capacitor trop lourds ; jetons ambre/cyan + markdown + Web Speech copiés en esprit). Express 5 + `express.static` + copie d'assets au build + PNG 96/192/512 générés. Coquille publique, `/api` et `/ws` JWT. Client aligné sur `authenticated` / `stream_*` / `stop` / `ping` / `confirmation_*`. Confirmations fail-closed, une réponse par id. `/api/runs` + trajectory (`buildTrajectory` déjà dans la base) + statut fournisseur / fichier optionnel / flotte. Sélecteur Agent = chat outils ; Lisa = `defaultReply` ; Pairs = registre + `peer.describe`/`peer.chat` (liste vide s'il n'y a pas de listener). CSP `script-src 'self'` sans `unsafe-eval` ni `unsafe-inline`. `tests/server` 65/67 fichiers, 588/590 tests, 0 rouge ; privacy 40/40 ; `tsc` 0 ; eslint ciblé 0. Essai `server --port 3461` : HTML 200, manifeste, SW, icônes ; WS `qwen3.8-ctx32k:latest` stream_start puis timeout 120 s (27 B, 0 chunk, generate Ollama aussi muet) ; même client sur 3462 `qwen3:4b-instruct` → chunks `OK MOBILE` + `stream_end`. P8 hors v1 listé. Aucun push.
