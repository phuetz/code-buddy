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
| D2 | À vérifier | — |
| D4 | À vérifier | — |
| D5 | À vérifier | — |
| D6 | À vérifier | — |
| D7 | À vérifier | — |

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

## Commits

- D3 : `c59c9b20f` — `fix(server): rétablir les routes statiques des webhooks`
