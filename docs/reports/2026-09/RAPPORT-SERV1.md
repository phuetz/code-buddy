# RAPPORT SERV1 — le serveur de Code Buddy branché par un inconnu

Date : 2026-09-03
Agent : Grok 4.6
Clone : `~/DEV/cb-serv1-2026-09-03`
Branche : `fix/serv1-serveur-reel-2026-09-03`
HEAD au démarrage : `6c6e43b58`
HEAD produit : `217d80c65` (lot documentaire)
Original `~/code-buddy` : interdit (jamais ouvert, jamais écrit)
Rapport créé **avant toute inspection** de `src/server/`.

## Mission

Éprouver en vrai `buddy server` comme un inconnu : SDK OpenAI officiel sur `/api/chat/completions` et `/v1/chat/completions`, JWT production, CORS/origines GHSA, A2A, 429, `/api/health`.

## Garde-fous tenus

- Aucun `git push`, `git prune`, `git reset --hard`, `rm -rf`, `git add -A`, `git commit -a`.
- Aucune API payante. Ollama `qwen3:4b-instruct` déjà chargé (`ollama ps`). Jamais un second gros modèle.
- Aucun service systemd. ComfyUI 8188 et pont 8129 intacts. Ports robot 3000/3001 non tués.
- HOME `_qa/serv1/home` dans le clone. Ports 3610 (HTTP+`/ws`) ; 3611 libre (un seul listener, voir écart doc).
- Zones gelées : `src/server/mcp/` (MCPFIX1), `src/index.ts` (HEADLESS1), `src/observability/` (TTFT1), sandbox (SANDBOX1).

## Journal

| Heure (Europe/Paris) | Action |
|---|---|
| 18:12 | Rapport créé **avant inspection**. Réservation `ced0ea345`. |
| 18:13–18:24 | Lecture CLAUDE.md, getting-started, infrastructure, deployment, agents, `src/server/`. |
| 18:24 | `ss -ltn` : 3000/3001/8188/8129 occupés. 3610 libre. `qwen3:4b-instruct` GPU. |
| 18:27 | `buddy server` réel `--port 3610 --host 127.0.0.1 --no-auth`. |
| 18:29 | JWT prod sans secret : EXIT 1 `SECURITY ERROR: JWT_SECRET…`. |
| 18:33 | JWT avec secret : sans jeton 401, avec jeton 200 `/api/chat/models`. |
| 18:33 | SDK non-stream : `SERV1-SDK-OK`, forme OpenAI. |
| 18:35 | SDK stream + SSE brut `data: {…}` puis `data: [DONE]`. Fuite Context Notice. |
| 18:36 | `tools` ignoré, l'agent a quand même appelé la météo interne. |
| 18:37 | Modèle inconnu → HTTP **200** avec excuse dans `content`. JSON malformé/vide → 400. |
| 18:33 | CORS evil GET 200 sans ACAO ; WS evil **403 Forbidden origin**. |
| 18:33 | Rate limit 3612 : 429 à la 97ᵉ (4 hits avant) `Retry-After` + `X-RateLimit-*`. |
| 18:40 | A2A card OK ; task `completed` vide, history `failed` GROK_API_KEY puis completed. |
| 18:43–18:55 | Correctifs rouge→vert, un commit chacun. |
| 18:56 | Relance 3610 : health `apiHeartbeat` réel 20 ms ; A2A `SERV1-A2A-OK`. |
| 19:02 | `tests/server` + privacy : 61 fichiers / 550 verts. `tsc` 0. ESLint ciblé 0. Ports 3610/3612 fermés. |

## Promesses de la doc (ligne par ligne)

### CLAUDE.md § HTTP Server
- `buddy server` : ports **3000 HTTP** et **3001 Gateway WS**.
- CORS, rate-limit **100 req/min**, JWT en production.
- Routes : `/api/health`, `/api/chat`, `/api/chat/completions` (OpenAI-compatible), `/api/sessions`, `/api/memory`, `/api/a2a/*`, canvas, a2ui.
- Gateway WS : `connect` / `hello_ok` / `auth` / `chat` / `session_*` / `presence` / `peer:*`.
- Origine durcie GHSA-5wcw-8jjv-m286, `corsOrigins` localhost-only.
- `/api/health.apiHeartbeat` : sonde 30 s (`heartbeat-monitor.ts`).

### docs/getting-started.md
- `buddy server --port 3000` expose REST/WebSocket.
- Flotte : listener = ce serveur, `/fleet listen ws://other-host:3000`.

### docs/infrastructure.md
- Port 3000, CORS, 100 req/min, JWT (`JWT_SECRET`).
- `/api/chat/completions` = OpenAI-compatible.
- WS `ws://localhost:3000/ws` (`authenticate`, `chat_stream`).
- Gateway séparé port 3001 (`connect` / `hello_ok`).
- GHSA, `corsOrigins` localhost-only.

### docs/deployment.md
- **Un processus, un port** : HTTP + WS `/ws`. Contradiction avec CLAUDE.md.
- Convention flotte : second **processus** sur 3001.
- `NODE_ENV=production` sans `JWT_SECRET` : refuse de démarrer.
- Rate limit 100 req/min (`RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW`).
- Health + `apiHeartbeat`.

### docs/agents.md
- AgentCard `GET /api/a2a/.well-known/agent.json`
- `POST /api/a2a/tasks/send`, `GET /api/a2a/tasks/:id`, `POST …/cancel`

## Preuves live (collées telles quelles)

### `ss -ltn` avant (extrait)
Ports 3000, 3001, 8188, 8129, 11434 occupés. **3610/3611 libres.** Robot et ComfyUI non tués.

### `ollama ps`
```
NAME                 ID              SIZE     PROCESSOR    CONTEXT    UNTIL
qwen3:4b-instruct    0edcdef34593    24 GB    100% GPU     262144     …
```

### Serveur
```
API Server started on http://127.0.0.1:3610
WebSocket: Enabled (/ws)
Auth: Disabled
Rate Limit: 100 req/60s
```

### SDK OpenAI non-streaming (`baseURL=http://127.0.0.1:3610/v1`)
```
{
  "id": "chatcmpl-b7375a6ba3f888e160460c3d",
  "object": "chat.completion",
  "created": 1788453224,
  "model": "qwen3:4b-instruct",
  "choices": [
    {
      "index": 0,
      "message": { "role": "assistant", "content": "SERV1-SDK-OK" },
      "finish_reason": "stop"
    }
  ],
  "usage": { "prompt_tokens": 13, "completion_tokens": 3, "total_tokens": 16 }
}
```
Forme OpenAI tenue (`choices[0].message.content`, `usage`, `id`, `model`). `usage.prompt_tokens: 13` est une estimation caractère/4 (le journal serveur disait 14 482 in) — **reste ouvert**.

### SDK streaming + SSE brut
Chunks `object: chat.completion.chunk` puis :
```
data: {"id":"chatcmpl-048c13ff9e309cd16ec2d272",…,"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{…}}

data: [DONE]
```
Avant correctif, un delta contenait `🟢 Context Notice: You have used 53.0%…` — fermé (`30c931c9a`).

### tools (avant correctif)
HTTP 200, `tool_calls: null`, `finish_reason: stop`, contenu météo Paris (l'agent interne a agi). Après : **400**
```
{"error":{"message":"This endpoint does not accept OpenAI tools, tool_choice, or functions. It does not return tool_calls.","type":"invalid_request_error","code":"unsupported_parameter"}}
```

### Erreurs
- JSON malformé : `400 {"code":"VALIDATION_ERROR","message":"Invalid JSON in request body",…}`
- Corps vide / `{}` : `400 {"error":{"message":"Missing required field(s): messages","type":"invalid_request_error","code":null}}`
- Modèle inconnu **avant** : HTTP **200** `Sorry, I encountered an error: … 404 model 'serv1-does-not-exist-xyz' not found`
- `max_tokens: -1` **après** : `400 {"error":{"message":"max_tokens must be an integer between 1 and 200000","type":"invalid_request_error","code":null}}`

### JWT production
Sans secret :
```
ERROR Failed to start server … SECURITY ERROR: JWT_SECRET environment variable must be set in production.
EXIT:1
```
Avec secret, sans jeton : `401 {"code":"UNAUTHORIZED","message":"No authentication token provided","status":401}`
Avec jeton : `200 {"object":"list","data":[{"id":"qwen3:4b-instruct",…,"owned_by":"ollama"}]}`

### CORS / WS (GHSA)
- Origin `http://127.0.0.1:3610` → 200 + `access-control-allow-origin: http://127.0.0.1:3610`
- Origin `https://evil.example` GET → **200** (corps servi) **sans** ACAO — le navigateur refuse, pas un 403 HTTP.
- WS `https://evil.example` → `403 Forbidden origin` (log `[ws] Rejected WebSocket connection from disallowed origin`).
- WS sans Origin (client non navigateur) → `open`.

### Rate limit (3612, 4 hits déjà consommés)
```
STATUS 97 429
HDR limit 100 rem 0 retry 26 reset 1788453248
BODY {"code":"RATE_LIMITED","message":"Too many requests","status":429,"details":{"limit":100,"windowMs":60000,"retryAfter":26,"route":"/api/health"}}
```

### A2A
AgentCard servie (`name`, `version`, `skills[]`, `capabilities`).
Avant : `status:completed` + history `failed` « GROK_API_KEY ».
Après :
```
{"id":"task_1788454816382_7i4h0","status":{"status":"completed",…},"result":"SERV1-A2A-OK","routedTo":"codebuddy"}
```
GET `/api/a2a/tasks/:id` : `submitted → working → completed`. (deux `completed` en history : cosmétique.)

### `/api/health` — valeurs réelles
Avant sonde OLLAMA_HOST : `apiHeartbeat.lastCheck: null`, `status: unknown`, `checks.api: unknown`, `status: degraded`.
Après `b59b3f24a` :
```
{"status":"ok","version":"2.0.0","uptime":45,"checks":{"database":"ok","api":"ok","memory":"ok"},
 "memory":{"heapUsedMB":48,"rssMB":171,…},
 "apiHeartbeat":{"lastCheck":"2026-09-03T16:56:47.381Z","latencyMs":20,"status":"ok"}}
```
Pas de constantes figées : uptime, mémoire, latency 20 ms, version `2.0.0` = `package.json`.

### `ss -ltn` final
3610/3611/3612 **fermés**. 3000/3001/8188/8129/11434 toujours là (pas à nous).

## Écarts

### E1 — max_tokens / tools / modèle inconnu malhonnêtes — FERMÉ (`28a981fcc`)
Rouge : 4/4 HTTP 200. Vert : 4/4 (400/404 OpenAI).

### E2 — A2A FAILED écrasé en COMPLETED — FERMÉ (`5bd4ca968`)
Rouge : `expected 'completed' to be 'failed'`. Vert + 18 voisins A2A.

### E3 — A2A inbound exigeait GROK_API_KEY — FERMÉ (`839c7a2ef`)
Ollama ignoré. Live après : `SERV1-A2A-OK`.

### E4 — Heartbeat ignore OLLAMA_HOST — FERMÉ (`b59b3f24a`)
Live après : `apiHeartbeat.latencyMs: 20`, `status: ok`.

### E5 — Context Notice dans le SSE OpenAI — FERMÉ (`30c931c9a`)

### E6 — AgentCard derrière JWT — FERMÉ (`957c7b60f`)
Découverte `GET /.well-known/agent.json` publique. JWT prod sans secret : test de non-démarrage.

### E7 — 429 : le plafond existait, le test middleware était tautologique — FERMÉ (`b39fa7e41`)
Live 429 + test HTTP réel (`Retry-After`, `X-RateLimit-Limit`).

## Reste ouvert (volontaire ou hors trou)

- `usage` OpenAI : estimation `len/4` du prompt user, pas les 14 482 tokens réels du journal. Pas inventé un compteur provider.
- HTTP CORS : origine non listée **n'est pas un 403** ; ACAO absent (spec CORS). Le WS **refuse** (403). Deux requêtes réelles collées.
- CLAUDE.md « 3000 HTTP + 3001 Gateway WS » : un `buddy server` n'ouvre **qu'un** port (`/ws` dessus). 3001 = second processus (deployment.md). Non réécrit.
- History A2A : deux entrées `completed` (exécuteur + `updateTaskStatus`). Cosmétique.
- Paquet `openai` déjà dans `node_modules` (`^5.23.2`) — utilisé, pas réinstallé.

## Vérifications

```
npx vitest run tests/server tests/security/donnees-personnelles.test.ts
 Test Files  61 passed (61)
      Tests  550 passed (550)
```
(Le `vitest.config.ts` exclut `**/*real*.test.ts` : 67 fichiers `tests/server` − 7 `*real*` + 1 privacy = 61.)

```
npx tsc --noEmit -p .     → 0
npx eslint <fichiers modifiés> --max-warnings=0  → 0
git diff --check          → 0
```

Commits : `ced0ea345` `28a981fcc` `5bd4ca968` `839c7a2ef` `b59b3f24a` `30c931c9a` `957c7b60f` `b39fa7e41` `217d80c65`. Aucun push.

## Bilan (≤ 10 lignes)

1. `buddy server` sur 3610 : `/v1/chat/completions` parle vraiment le SDK `openai` (non-stream `SERV1-SDK-OK`, stream SSE + `[DONE]`).
2. JWT prod : sans secret EXIT 1 ; sans jeton 401 ; avec jeton 200 — les trois collés.
3. 429 réel à 100 req/min avec `Retry-After` / `X-RateLimit-*`.
4. Health n'est pas hardcodé ; après correctif le battement Ollama fait 20 ms `ok`.
5. WS GHSA : origine evil 403. HTTP : 200 sans ACAO (CORS, pas un 403).
6. A2A : AgentCard + cycle send→GET `SERV1-A2A-OK` après Ollama + FAILED non écrasé.
7. Trous fermés : tools/max_tokens/modèle 400-404, A2A failed, A2A Ollama, heartbeat HOST, Context Notice, AgentCard public.
8. Preuve tests : **61 fichiers / 550 verts** ; `tsc` 0 ; ESLint ciblé 0 ; `git diff --check` 0.
9. `ss -ltn` final : 3610/3612 fermés ; 3000/3001/8188 intacts.
10. Reste : `usage` estimé ; un port pas deux ; CORS HTTP sans 403.
