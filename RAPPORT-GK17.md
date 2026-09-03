# RAPPORT-GK17 — La flotte multi-IA en vrai : deux pairs sur la même machine

Mission : se servir de la fonctionnalité phare de Code Buddy 2 (flotte multi-IA) **en vrai** — deux `buddy server` sur la même machine, Ollama local, HOME temporaire dans le clone.

- Clone : `/home/patrice/DEV/cb-repar-companion-2026-09-02`
- Branche : `fix/gk17-fleet-reel-2026-09-03`
- Date : 2026-09-03 (Europe/Paris)
- Agent : Grok 4.6
- Rapport créé **avant** toute inspection du code source.
- HEAD de travail avant ce lot documentaire : `1846309b0`

## Garde-fous

- Aucun push, aucun `git prune` / `git reset --hard` / `rm -rf` / `git add -A` / `git commit -a`.
- Aucune API payante. LLM : Ollama `qwen3:4b-instruct` sur `127.0.0.1:11434`.
- Aucun service systemd. ComfyUI 8188/8189 non touché.
- HOME temporaire `_gk17/home-{a,b}/` dans le clone (gitignoré).
- Ports GK17 : **3410** (A) et **3420** (B). Jamais 3000 / 3001 / 3055 / 8129.
- `~/code-buddy` interdit.

## Setup réel

Deux processus `tsx src/index.ts server --host 127.0.0.1` :

| Pair | HTTP/WS | HOME | `CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT` | Concurrency |
|---|---|---|---|---|
| A `gk17-peer-a` | 127.0.0.1:3410 | `_gk17/home-a` | `_gk17/ws-a` | (unset) |
| B `gk17-peer-b` | 127.0.0.1:3420 | `_gk17/home-b` | `_gk17/ws-b` | `CODEBUDDY_FLEET_MAX_CONCURRENCY=1` |

JWT partagé `JWT_SECRET=gk17-fleet-reel-2026-09-03-ministar`. `buddy fleet token` + `/fleet listen --jwt` (après correctif). `peer.chat wired: ollama (qwen3:4b-instruct, local)` dans les journaux A et B.

Le coordinateur a exercé le **vrai handler slash** `handleFleet` (`/fleet listen|describe|send|tool|route|chat`).

## Défauts trouvés en vrai → correctifs

### 1. `/fleet listen --jwt` documenté mais absent — `8d5218851`

`docs/fleet-guide.md`, `buddy fleet token` et `buddy council` disent `/fleet listen --jwt <token>`. Le handler n’acceptait que `--api-key` → `Error: no apiKey provided`.

- Rouge : `tests/fleet/fleet-handler.test.ts` « accepts jwt via --jwt » → `no apiKey provided`.
- Vert : 78/78. ESLint ciblé 0.

### 2. Idle WS 60 s tue `/fleet listen` et `peer.chat` — `7e2f11df0`

Premier `peer.chat` : `DISCONNECTED: connection closed` à ~65 s. Les deux listeners tombaient. Cause : `WS_IDLE_TIMEOUT=60000` ne comptait que les frames applicatives. Un listener receive-only et un LLM local >60 s se faisaient `terminate`. Les `pong` de keepalive ne rafraîchissaient pas `lastActivity`.

- Rouge : `tests/server/websocket-idle-keepalive.test.ts` (idle 800 ms) → `NOT_AUTHENTICATED` après silence.
- Vert : 3/3. Après correctif, `peer.chat` A→B **70,7 s** : `"text": "GK17-OLLAMA-OK"`.

### 3. `peer.tool.invoke` auto-refus headless — `5e9cf40af`

`view_file` / `search` : `PEER_INVOKE_DENIED: Human approval was rejected or timed out` en 5–8 ms. PolicyEngine met `peer:invoke` en `needs_approval` → ConfirmationService sans TTY auto-refuse. Les trois gates documentées (allowlist, fleetSafe, workspace) étaient déjà passées.

- Rouge : `tests/server/peer-tool-bridge.test.ts` headless view_file.
- Vert : 27/27. Live : `view_file` → `GK17-B-VISIBLE` ; `search` → `GK17-B-NESTED` ; hors workspace / `../` / `/etc/hostname` → `PATH_OUTSIDE_PEER_WORKSPACE`.

### 4. File canal 120 s coupe `peer.chat` — `1846309b0`

Avant l’allongement : `HANDLER_ERROR: Task timed out after 120000ms` alors qu’un `chat say` suivant a répondu en 83 s. `enqueueMessage` héritait du défaut canal 120 s. RPC `peer.*` : 15 min.

## Tableau final

| # | Scénario | Attendu | Obtenu | Correctif |
|---|---|---|---|---|
| 1 | `/fleet describe` depuis A | Décrit le pair B | `hostname: gk17-peer-b`, `peerChatProvider.ollama` / `qwen3:4b-instruct`, `maxConcurrency: 1` | — |
| 2 | `peer.chat` A→B | Réponse réelle Ollama | Après keepalive+timeout : `"text": "GK17-OLLAMA-OK"` en 70680 ms, `providerResolved: ollama`, 31+10 tokens | `7e2f11df0` + `1846309b0` |
| 3 | `peer.chat-session.start/continue/end` | Session multi-tour | `start` sessionId `sess_mtldo870_…` ; `say` → « Acknowledged. Marker received and understood. » (80872 ms) | — |
| 4 | `peer.chat-session.list` | Métadonnées seulement | JSON : `sessionId`, `turnCount`, `ageMs`, `idleMs`, `expiresInMs`. **Pas** de `GK17-SESSION-SECRET-NEVER-LIST`, ni prompt, ni `text` | déjà testé `peer-session-bridge.test.ts` « NEVER exposes… » |
| 5 | `peer.tool.invoke` `view_file`/`search` in-workspace | Lecture OK | `hello from peer B workspace — distinctive token GK17-B-VISIBLE` ; search `GK17-B-NESTED` | `5e9cf40af` |
| 6 | hors workspace | REFUS fail-closed | `PATH_OUTSIDE_PEER_WORKSPACE` pour chemin absolu hors root, `../outside-b/secret.md`, `/etc/hostname` | — (déjà là) |
| 7 | `/fleet route` + IBAN factice `FR76 30006 00001 12345678901 89` | Lint vie privée | **Détecte** (`hasSecrets: true`, `matchKinds: ["pii-iban"]`, `privacyTag: sensitive`). **Ne bloque pas** : recommande `peerB` / ollama ; `nextCall.args.prompt` contient encore l’IBAN. Conforme au guide (bump `sensitive`, pas reject sauf Cowork `public` forcé) | aucun : comportement documenté, pas un silence |
| 8 | `CODEBUDDY_FLEET_MAX_CONCURRENCY=1` + 2 `peer.chat` | Saturation visible | 1er : timeout 120 s (avant correctif 4) ; 2e : **`SATURATED: peer.chat: fleet concurrency limit reached`** | saturation déjà câblée ; visible en vrai |
| 9 | `peer.dispatch` + `dispatchStatus` | Dispatch + statut | `runId disp_mtldpymm_m1p5ld` accepté ; status **`completed`**, `result: "GK17-DISPATCH-OK"` | — |
| 10 | Arrêt de B pendant une session | Erreur honnête | SIGTERM pid B ; `/fleet chat say` → **`Peer "peerB" is no longer connected. Chat session "gk17crash" dropped locally.`** | — |
| 11 | Arrêt final | Ports GK17 absents | `ss -ltn` : 3410/3420 absents. Restent 3000/3001/3055/8129/8188/11434 (préexistants, non touchés) | — |
| 12 | `/fleet listen --jwt` | Chemin documenté | Avant : refusé. Après : listen A+B OK | `8d5218851` |

## Preuves collées (extraits)

`peer.chat` réel :

```
Peer "peerB" → peer.chat OK (70680ms):
{ "text": "GK17-OLLAMA-OK", "providerResolved": "ollama", "finishReason": "stop",
  "usage": { "prompt_tokens": 31, "completion_tokens": 10, "total_tokens": 41 } }
```

Liste session (aucun secret) : `count: 2`, champs metadata only.

Outils : in-workspace OK ; hors workspace `PATH_OUTSIDE_PEER_WORKSPACE`.

Saturation : `peer.invoke SATURATED: peer.chat: fleet concurrency limit reached`.

Crash B : `Peer "peerB" is no longer connected. Chat session "gk17crash" dropped locally.`

`ss -ltn` après arrêt (extrait) :

```
LISTEN 127.0.0.1:3055
LISTEN 127.0.0.1:8188
LISTEN 127.0.0.1:8129
LISTEN 0.0.0.0:3000
LISTEN 0.0.0.0:3001
LISTEN 203.0.113.10:8188
LISTEN *:11434
```

3410 et 3420 absents.

## Commits

| Commit | Sujet |
|---|---|
| `72e590bc8` | chore(gk17): réserver le chantier |
| `8d5218851` | fix(fleet): `/fleet listen --jwt` |
| `7e2f11df0` | fix(fleet): keepalive WS idle |
| `5e9cf40af` | fix(fleet): peer.tool.invoke sans TTY |
| `1846309b0` | fix(fleet): timeout file peer.chat 15 min |
| (ce document) | docs(gk17): rapport de clôture |

## Restes ouverts (pas des mensonges, des limites)

- `/fleet route` **détecte** l’IBAN et tague `sensitive` mais **n’interdit pas** le routage local ; le prompt IBAN reste dans `nextCall`. C’est le contrat actuel (bump, pas reject).
- `peer.describe` publicite aussi gemini-cli / lemonade / omniroute présents sur PATH, même HOME isolé. `peerChatProvider` reste ollama.
- Santé API `degraded` (better-sqlite3 non rebuild — `npm ci --ignore-scripts`). La flotte WS n’en dépend pas.
- Sessions pair persistées sous `_gk17/home-b` (gitignoré) : un `list` après relance peut montrer un vieil id, toujours sans contenu.

## Bilan (≤ 10 lignes)

Deux `buddy server` réels (3410/3420), Ollama `qwen3:4b-instruct`, HOME dans le clone. `/fleet describe` voit B (ollama local). `peer.chat` répond `GK17-OLLAMA-OK` (70,7 s). Session start/continue/list : liste **sans** le marqueur secret. `view_file`/`search` lisent le workspace B et refusent hors root. Route+IBAN : lint `pii-iban` + `sensitive`, pas de blocage. Concurrency=1 : second appel `SATURATED`. `peer.dispatch` → `completed` / `GK17-DISPATCH-OK`. Kill B : message honnête « no longer connected ». Quatre correctifs commités (`--jwt`, keepalive WS, outils headless, timeout 15 min). Ports 3410/3420 absents de `ss -ltn` ; 8188/3000/3001 intacts.
