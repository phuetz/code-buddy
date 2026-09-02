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
| D1 | À vérifier | — |
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

## Commits

Un commit français `fix(server): …` sera créé pour chaque diagnostic confirmé.
