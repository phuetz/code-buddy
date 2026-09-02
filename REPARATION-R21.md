# RÉPARATION R21 — routes du serveur HTTP

- Dépôt : `/home/patrice/DEV/cb-repar-server-2026-09-02`
- Branche : `fix/repar-server-2026-09-02`
- Date : 2026-09-02
- Audit source : `AUDIT-A-REPARER.md`, lu intégralement avant correction
- Coordination : consultée ; non modifiée conformément à la mission
- Réseau / LLM réels : interdits et non utilisés

## Verdicts au code

| Diagnostic | Verdict | Preuve / correction |
|---|---|---|
| D3 | Confirmé | `POST /:source` précédait les POST statiques ; route dynamique déplacée après `/triggers` et `/test`. |
| D1 | Confirmé | Les quatre handlers mutaient après la dernière sauvegarde ; chaque mutation est désormais suivie de `saveSession()`. |
| D2 | Confirmé | `saveMemories()` sautait l’écriture dégradée ; il lève désormais une erreur dédiée, traduite en 503, et `remember()` restaure sa Map. |
| D4 | Confirmé | Aucun abonné ne lançait l’agent ; une file bornée exécute maintenant `runAgentCompletion()` et la route ne répond 202 qu’après acceptation. |
| D5 | Confirmé | Le `catch` envoyait `stop` puis `error` ; il émet maintenant uniquement l’événement terminal `error`. |
| D6 | Confirmé | `criticalPassing` ignorait `grokApi`; la dernière sonde Grok participe désormais au 200/503 et à `ready`. |
| D7 | Confirmé | `checkApi()` assimilait configuration et joignabilité ; `checks.api` reprend désormais le heartbeat observé (`ok`, `stale`, `unknown`). |

## Cycles rouge → vert et vérifications

### D3 — ordre des routes webhook

Rouge, avant correction :

```text
$ npx vitest run tests/server/webhooks-routes.test.ts
Tests  1 failed (1)
AssertionError: expected 200 to be 201
EXIT_CODE=1
```

Vert, après correction :

```text
$ npx vitest run tests/server/webhooks-routes.test.ts
Test Files  1 passed (1)
Tests  1 passed (1)
$ npx eslint src/server/routes/webhooks.ts tests/server/webhooks-routes.test.ts
EXIT_CODE=0
$ git diff --check
EXIT_CODE=0
```

### D1 — persistance des sessions

Rouge, avant correction :

```text
$ npx vitest run tests/server/sessions-routes-persistence.test.ts
Test Files  1 failed (1)
Tests  1 failed (1)
Expected: name="R21 renommée", description et message
Received: name="R21 initiale", messages=[]
EXIT_CODE=1
```

Vert, après correction et relecture par un second `SessionStore` :

```text
$ npx vitest run tests/server/sessions-routes-persistence.test.ts
Test Files  1 passed (1)
Tests  1 passed (1)
$ npx eslint src/server/routes/sessions.ts tests/server/sessions-routes-persistence.test.ts
EXIT_CODE=0
$ git diff --check
EXIT_CODE=0
```

### D2 — échec de persistance mémoire

Rouge, magasin projet illisible avant correction :

```text
$ npx vitest run tests/server/memory-routes-persistence-error.test.ts
Test Files  1 failed (1)
Tests  1 failed (1)
AssertionError: expected 201 to be 503
EXIT_CODE=1
```

Vert, avec propagation en 503 et message explicite :

```text
$ npx vitest run tests/server/memory-routes-persistence-error.test.ts
Test Files  1 passed (1)
Tests  1 passed (1)
$ npx eslint src/memory/persistent-memory.ts src/server/routes/memory.ts tests/server/memory-routes-persistence-error.test.ts
EXIT_CODE=0
$ git diff --check
EXIT_CODE=0
```

### D4 — mise en file réelle des webhooks

Rouge, avant correction :

```text
$ npx vitest run tests/server/webhooks-routes.test.ts
Test Files  1 failed (1)
Tests  1 failed | 1 passed (2)
AssertionError: expected 200 to be 202
EXIT_CODE=1
```

Vert : succès 202/run, refus 503 sans run, et câblage du faux agent :

```text
$ npx vitest run tests/server/webhooks-routes.test.ts tests/server/webhook-agent-queue.test.ts
Test Files  2 passed (2)
Tests  4 passed (4)
$ npx eslint src/server/routes/webhooks.ts src/server/webhook-agent-queue.ts tests/server/webhooks-routes.test.ts tests/server/webhook-agent-queue.test.ts
EXIT_CODE=0
$ git diff --check
EXIT_CODE=0
```

### D5 — terminaison honnête du flux SSE

Rouge, faux fournisseur cassé après le premier delta :

```text
$ npx vitest run tests/server/chat-stream-mid-error.test.ts
Test Files  1 failed (1)
Tests  1 failed (1)
AssertionError: expected 3 events to have a length of 2
EXIT_CODE=1
```

Vert, un delta puis un seul événement terminal `error` :

```text
$ npx vitest run tests/server/chat-stream-mid-error.test.ts
Test Files  1 passed (1)
Tests  1 passed (1)
$ npx eslint src/server/routes/chat.ts tests/server/chat-stream-mid-error.test.ts
EXIT_CODE=0
$ git diff --check
EXIT_CODE=0
```

### D6 — readiness après échec de sonde

Rouge, base et mémoire saines mais sonde Grok en échec :

```text
$ npx vitest run tests/server/health-ready.test.ts
Test Files  1 failed (1)
Tests  1 failed (1)
AssertionError: expected 200 to be 503
EXIT_CODE=1
```

Vert : `grokApi.ready=false`, HTTP 503 et `ready=false` :

```text
$ npx vitest run tests/server/health-ready.test.ts
Test Files  1 passed (1)
Tests  1 passed (1)
$ npx eslint src/server/routes/health.ts tests/server/health-ready.test.ts
EXIT_CODE=0
$ git diff --check
EXIT_CODE=0
```

### D7 — santé API inconnue sans sonde

Rouge, avant toute sonde réussie :

```text
$ npx vitest run tests/server/health-ready.test.ts -t "n’annonce pas api ok"
Test Files  1 failed (1)
Tests  1 failed | 1 skipped (2)
AssertionError: expected 'ok' to be 'unknown'
EXIT_CODE=1
```

Vert, les contrats D6 et D7 ensemble :

```text
$ npx vitest run tests/server/health-ready.test.ts
Test Files  1 passed (1)
Tests  2 passed (2)
$ npx eslint src/server/routes/health.ts tests/server/health-ready.test.ts
EXIT_CODE=0
$ git diff --check
EXIT_CODE=0
```

## Vérification finale

```text
$ npx vitest run tests/server/webhooks-routes.test.ts tests/server/webhook-agent-queue.test.ts tests/server/sessions-routes-persistence.test.ts tests/server/memory-routes-persistence-error.test.ts tests/server/chat-stream-mid-error.test.ts tests/server/health-ready.test.ts
Test Files  6 passed (6)
Tests  9 passed (9)

$ npm run typecheck
> tsc --noEmit && npm run typecheck:darkstar-identity
> tsc --project tsconfig.darkstar-identity.json
EXIT_CODE=0

$ npx eslint src/server/routes/webhooks.ts src/server/webhook-agent-queue.ts src/server/routes/sessions.ts src/memory/persistent-memory.ts src/server/routes/memory.ts src/server/routes/chat.ts src/server/routes/health.ts tests/server/webhooks-routes.test.ts tests/server/webhook-agent-queue.test.ts tests/server/sessions-routes-persistence.test.ts tests/server/memory-routes-persistence-error.test.ts tests/server/chat-stream-mid-error.test.ts tests/server/health-ready.test.ts
EXIT_CODE=0

$ git diff --check
EXIT_CODE=0
```

## Commits

- D3 : `c59c9b20f` — `fix(server): rétablir les routes statiques des webhooks`
- D1 : `aaa8e5ec7` — `fix(server): persister les écritures de session`
- D2 : `7dd02f9bd` — `fix(server): signaler l'échec de persistance mémoire`
- D4 : `591fa6e05` — `fix(server): mettre les webhooks en file d'agent`
- D5 : `8bba81019` — `fix(server): terminer honnêtement les flux en erreur`
- D6 : `6a9d43c51` — `fix(server): refléter l'échec de la sonde de disponibilité`
- D7 : commit portant la version finale de ce rapport — `fix(server): ne pas inventer la santé de l'API`
