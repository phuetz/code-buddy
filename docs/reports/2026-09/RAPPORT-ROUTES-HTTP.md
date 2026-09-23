# Catalogue des routes HTTP — 23/09/2026

État **source** : `origin/main` `6f745f0e8` (branche `test/catalogue-routes-http-2026-09-23`).
État **candidat** : cette branche, commits locaux uniquement.
État **déployé** : inchangé. Aucun push, aucune fusion, aucun service réel, profil utilisateur non lu.

Le matériau Jules HTTP-A (`tests/verification-routes.test.ts`) ne se charge pas sur cette base : il importe le paquet `jsonwebtoken`, absent du dépôt, en JavaScript non typé, avec des espaces en fin de ligne, un `catch` vide et une assertion conditionnelle (`200 || 503`). HTTP-B s'arrêtait sur `if (!process.env.RUN_REAL_TESTS) return`, donc les tests passaient sans rien appeler. Rien de ces fichiers n'est repris tel quel. Le jeton vient de `createUserToken` (`src/server/auth/jwt.ts`), le même mécanisme que les tests de `tests/server`.

Serveur réel en processus, `127.0.0.1`, port 0, `HOME`, `CODEBUDDY_HOME`, `CODEBUDDY_SESSIONS_DIR` et répertoire de travail temporaires. Les variables de fournisseur sont retirées du processus de test pour qu'aucune API payante ne soit appelée. Aucun mock du gestionnaire.

## Partie A — 18 routes

| Route | Enregistrement | Classe | Preuve |
|---|---|---|---|
| GET /api/health | `src/server/routes/health.ts:233` | TESTÉ_FONCTIONNEL | 200, `status` `degraded`, `version` `2.2.0`, `checks.database` `error`, `checks.api` `unknown`, `checks.memory` `ok` |
| GET /api/health/live | `src/server/routes/health.ts:366` | TESTÉ_FONCTIONNEL | 200, `alive` true, `status` `ok`, `pid` du processus |
| GET /api/health/ready | `src/server/routes/health.ts:298` | TESTÉ_FONCTIONNEL | 503, `ready` false, `status` `not_ready`, fournisseur absent, base non prête, mémoire prête |
| GET /api/health/metrics | `src/server/routes/health.ts:423` | TESTÉ_FONCTIONNEL | 200, texte Prometheus (`codebuddy_uptime_seconds`, `codebuddy_memory_rss_bytes`) |
| GET /api/docs | `src/server/index.ts:881` | PARTIEL | 401 sans jeton (`UNAUTHORIZED` / `No authentication token provided`). Avec jeton : 200, OpenAPI 3.0.0, titre Code Buddy API. L'URL annoncée est `http://127.0.0.1:0` alors que le port lié est > 0 |
| GET /api/sessions | `src/server/routes/sessions.ts:79` | TESTÉ_FONCTIONNEL | 401 sans jeton, corps exact. Avec jeton : 200, `sessions` `[]`, `total` 0, `limit` 50, `offset` 0 |
| POST /api/sessions | `src/server/routes/sessions.ts:236` | TESTÉ_FONCTIONNEL | 401 sans jeton. Avec jeton : 201, nom `Catalogue HTTP`, modèle `grok-3-latest`. Relu dans GET /api/sessions (`total` 1) |
| GET /api/sessions/:id | `src/server/routes/sessions.ts:204` | TESTÉ_FONCTIONNEL | 200, même id, nom et modèle, `messageCount` 0 |
| POST /api/sessions/:id/messages | `src/server/routes/sessions.ts:394` | TESTÉ_FONCTIONNEL | 401 sans jeton. 201, `role` `user`, contenu exact |
| GET /api/sessions/:id/messages | `src/server/routes/sessions.ts:363` | TESTÉ_FONCTIONNEL | relecture : `total` 1, message `{ type: user, content }` |
| GET /api/memory | `src/server/routes/memory.ts:118` | TESTÉ_FONCTIONNEL | 200, `entries` `[]`, `total` 0, puis 1 après création |
| POST /api/memory | `src/server/routes/memory.ts:151` | TESTÉ_FONCTIONNEL | 401 sans jeton, relecture inchangée (`total` 0). 201, contenu exact, catégorie forcée `custom` (l'entrée `note` n'est pas une catégorie acceptée). Relu par GET |
| GET /api/tools | `src/server/routes/tools.ts:94` | TESTÉ_FONCTIONNEL | 401 sans jeton. 200, `total` égal à la longueur, `view_file` présent |
| GET /api/lessons | `src/server/routes/lessons.ts:51` | TESTÉ_FONCTIONNEL | 200, liste vide puis 1 après création |
| POST /api/lessons | `src/server/routes/lessons.ts:66` | TESTÉ_FONCTIONNEL | 201, catégorie `INSIGHT`, contenu relu par GET |
| GET /api/runs | `src/server/routes/runs.ts:21` | TESTÉ_FONCTIONNEL | 401 sans jeton. 200, `{ runs: [] }` |
| GET /api/groups/status | `src/server/index.ts:748` | TESTÉ_FONCTIONNEL | 200, `enabled` true, `totalGroups` 0, `defaultMode` `mention-only` |
| GET /api/webhooks/triggers | `src/server/routes/webhooks.ts:32` | TESTÉ_FONCTIONNEL | 200, `{ triggers: [], count: 0 }` |

Le refus anonyme asserté a le corps exact `{ code: "UNAUTHORIZED", message: "No authentication token provided", status: 401 }` (`src/server/middleware/auth.ts:87`).

## Partie B — 15 routes

| Route | Enregistrement | Classe | Preuve |
|---|---|---|---|
| GET /api/fleet/status | `src/server/index.ts:313` | TESTÉ_FONCTIONNEL | 401 sans jeton. 200, `{ status: "ok", connections: { total: 0, authenticated: 0, streaming: 0, totalBroadcastsDropped: 0 } }` |
| GET /api/fleet/describe | `src/server/index.ts:320` | TESTÉ_FONCTIONNEL | 200, `httpMethods` `["peer.describe"]`, `methods` contient `peer.describe`, nom d'hôte non vide |
| GET /api/fleet/peers | `src/server/routes/runs.ts:65` (monté par `src/server/index.ts:374`) | TESTÉ_FONCTIONNEL | 401 sans jeton. 200, `{ peers: [] }` |
| GET /api/a2a/.well-known/agent.json | `src/server/routes/a2a-protocol.ts:137` (monté `src/server/index.ts:304`) | TESTÉ_FONCTIONNEL | 200 **sans** jeton (exception publique), `name` `Code Buddy`, skill `code-search` |
| GET /api/a2a/agents | `src/server/routes/a2a-protocol.ts:150` | TESTÉ_FONCTIONNEL | 401 sans jeton. 200, `codebuddy` présent, `remoteAgents` `[]` puis relu après register / delete |
| POST /api/a2a/agents/register | `src/server/routes/a2a-protocol.ts:249` | TESTÉ_FONCTIONNEL | 200, `{ status: "registered", agent, url }`. URL d'essai `http://192.0.2.10/a2a` (plage de documentation). Relu dans `remoteAgents` |
| POST /api/a2a/agents/:name/heartbeat | `src/server/routes/a2a-protocol.ts:269` | TESTÉ_FONCTIONNEL | 200, `status` `ok`. `lastHeartbeat` relu, supérieur ou égal à la valeur d'enregistrement |
| DELETE /api/a2a/agents/:name | `src/server/routes/a2a-protocol.ts:279` | TESTÉ_FONCTIONNEL | 200, `{ status: "unregistered", agent }`. Relecture : `remoteAgents` `[]` |
| GET /api/a2a/tasks/:id | `src/server/routes/a2a-protocol.ts:198` | TESTÉ_FONCTIONNEL | 404, `{ error: "Task not found" }` pour un id absent |
| POST /api/a2a/tasks/:id/cancel | `src/server/routes/a2a-protocol.ts:220` | TESTÉ_FONCTIONNEL | 404, `{ error: "Task not found or already completed" }` |
| POST /api/a2a/tasks/send | `src/server/routes/a2a-protocol.ts:168` | PARTIEL | 400, `{ error: "Missing required field: message" }`. Le chemin nominal appellerait l'exécuteur de tâches (modèle) : non appelé |
| WebSocket /ws | `src/server/websocket/handler.ts:1868` | TESTÉ_FONCTIONNEL | Client `ws` réel. Trame `connected` (`authRequired` true, méthodes `authenticate`, `ping`, `session.attach`). `session.attach` sans jeton : `error` `UNAUTHORIZED` / `Authentication required`. `ping` → `pong`. `authenticate` → `authenticated` avec `userId` `catalogue-http-user` |
| Partage de session sur /ws | `session.attach` `src/server/websocket/handler.ts:1016`, `session.detach` ligne 1048, présence `src/server/sessions/shared-presence.ts:107` | TESTÉ_FONCTIONNEL | Session créée par POST /api/sessions, deux clients. Le second `session_attached` a 2 participants, le premier reçoit `session_presence` à 2, `session.detach` renvoie l'id |
| WebChat GET /api/health | `src/channels/webchat/index.ts:360` | TESTÉ_FONCTIONNEL | Canal réel sur `127.0.0.1` port 0. 200, `status` `ok`, `clients` 0 puis 2 |
| WebChat GET /api/history + WebSocket | historique ligne 370, connexion ligne 388 | TESTÉ_FONCTIONNEL | Message sans jeton : `{ type: "system", content: "Please authenticate first" }`. Mauvais jeton : `Authentication failed` puis fermeture. Deux clients authentifiés : diffusion `catalogue-webchat-preuve`, relu dans `/api/history` (1 message, même contenu) |

## Défauts signalés, non corrigés

1. **OpenAPI annonce le port 0.** `GET /api/docs` construit `servers[0].url` avec `config.port` (`src/server/index.ts:890`), qui reste 0 quand on écoute sur un port éphémère. Le test assert `http://127.0.0.1:0` et un port lié > 0. Classe PARTIEL. Pas de correctif : il faudrait relire l'adresse liée après `listen`, ce qui n'a pas été prouvé par un mutant.
2. **WebChat mémorise le port demandé, pas le port lié.** `connect()` écrit `status.info.port` avec l'argument (`src/channels/webchat/index.ts:164-170`). Pour le port 0, ce champ reste 0 ; le test joint le port réel via `server.address()`. Les routes HTTP, elles, répondent. Pas de correctif.
3. **Santé base de données en erreur sous Vitest.** `GET /api/health` renvoie `checks.database` `error` et `/ready` `Database connection failed`. Cause observée : `import('better-sqlite3')` dans le runner Vitest ne trouve pas le binaire natif du `node_modules` lié. Le même import sous `node` nu répond OK. Les sessions passent par le repli JSON et ont été relues. Ce n'est pas un correctif de route ; rien n'a été réinstallé.

## Exécutions

Chaque fichier, trois fois de suite, reporter verbose, `NO_COLOR=1`.

Partie A, les trois résumés :

```
 Test Files  1 passed (1)
      Tests  15 passed (15)
```

```
 Test Files  1 passed (1)
      Tests  15 passed (15)
```

```
 Test Files  1 passed (1)
      Tests  15 passed (15)
```

Partie B, les trois résumés :

```
 Test Files  1 passed (1)
      Tests  13 passed (13)
```

```
 Test Files  1 passed (1)
      Tests  13 passed (13)
```

```
 Test Files  1 passed (1)
      Tests  13 passed (13)
```

15 cas distincts en A (18 routes), 13 cas distincts en B (15 routes). `eslint --quiet` sur les trois fichiers : 0. `git diff --check` : 0. Après la suite, `git status` ne montre que ces fichiers et ce rapport (assertion dans chaque fichier).

Inventaire Express : 150 sites `app.|router.METHOD(` sous `src/server` et le webchat n'y figure pas (branches `if` dans `handleHttpRequest`). Les sites non cités dans les tableaux ci-dessus sont **NON_TESTABLE_ICI** : hors plafond 18+15, ou bien ils appellent un modèle, un pair distant, un appareil ou un fournisseur. En particulier `src/server/routes/a2a-jsonrpc.ts:37` et `:38` (`/.well-known/agent-card.json`, `POST /a2a/v1`) ne sont montés que si `CODEBUDDY_A2A_PEERS` est défini (`src/server/index.ts:259`) ; cette variable a été retirée du processus de test, les routes n'ont pas été appelées.

## Ce que je n'ai pas pu vérifier

- Une base SQLite saine pendant ces tests : le binaire natif n'est pas résolu sous Vitest. L'import direct par `node` réussit. Aucun `npm rebuild` (installation interdite).
- Le succès de `POST /api/a2a/tasks/send` avec un message : cela lancerait l'exécuteur et un modèle.
- Les routes JSON-RPC A2A, le chat (`/api/chat`, `/v1`), la recherche du hub, les démons, le cron, les battements qui sortent du processus, l'authentification d'appareil.
- Un client navigateur sur le HTML du webchat. Seuls HTTP et un client WebSocket de test ont été exercés.
- Windows, macOS, et une barrière Docker : la mission n'en nomme pas, et elle demande le serveur en processus dans ce worktree.
- La suite complète du dépôt (~27 000 tests).
- `tests/security/donnees-personnelles.test.ts` : 40 tests verts après le commit des tests, puis encore 40 après le commit de ce rapport (arbre suivi, y compris ce fichier).
- Le profil réel de l'utilisateur : il n'a pas été ouvert.
