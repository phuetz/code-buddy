# PR #42 — Liste des améliorations

> **PR :** [#42 — Self-improve, Cowork pilotability & 1.0.0 GA audit hardening](https://github.com/phuetz/code-buddy/pull/42)
> **Branche :** `tmp-self-improve-default` → `main`
> **Date :** 2026-05-29

Ce document récapitule le **travail de durcissement « 1.0.0 GA »** réalisé dans cette session, qui forme la tête de la PR #42 (4 commits). Il s'appuie sur l'audit complet consigné dans [`AUDIT-2026-05-29.md`](AUDIT-2026-05-29.md).

> ℹ️ La PR #42 regroupe l'ensemble de la divergence de la branche (~218 commits) : elle inclut aussi le travail antérieur sur la **pilotabilité Cowork**, la **boucle d'auto-amélioration (D1/D2/D3)**, le **pilotage universel WinForms/WPF/Avalonia**, etc. Ce fichier se concentre sur les 4 commits d'audit GA listés ci-dessous.

---

## Vue d'ensemble (4 commits)

| Commit | Sujet | Impact |
|--------|-------|--------|
| `916b1f1b` | `fix: resolve 1.0.0 GA audit findings (security, deps, version, tests)` | 21 fichiers, +454 / −47 |
| `e1cc6c4c` | `fix: repair 39 pre-existing failing tests + guard before-tool-call hook` | 7 fichiers, +77 / −22 |
| `c116cb77` | `refactor: enable noUncheckedIndexedAccess across the codebase` | 529 fichiers, +4581 / −2348 |
| `b329dd7a` | `docs: update audit status — 2.6 migration + 39 red tests complete` | 1 fichier |

**État final :** typecheck `0`, lint `0`, suite complète verte (986 fichiers / 29 116 passants / 0 échec / 88 skips), `noUncheckedIndexedAccess` **ON**.

---

## 1. Sécurité réseau — posture *secure-by-default* (audit 0.1)

Concerne uniquement l'utilisateur qui lance explicitement `buddy server`.

- **`src/server/origin-check.ts` (NOUVEAU)** — module-feuille partagé : `isOriginAllowed(origin, allowed)`, `isLoopbackHost(host)`, `DEFAULT_LOCALHOST_ORIGINS`. Évite un cycle d'import server ↔ gateway.
- **`src/server/index.ts`** — CORS par défaut = liste localhost (au lieu de `*`) ; validation d'origine en *function-form* (autorise les requêtes sans `Origin`, ex. CLI/fleet) ; **avertissement au boot** si le serveur écoute sur une interface non-loopback.
- **`src/server/websocket/handler.ts`** — ajout d'un `verifyClient` sur le WebSocket `/ws` (port REST 3000), qui validait l'`Origin` des navigateurs tout en laissant passer les clients sans origine (CLI/fleet). Comble l'écart avec le Gateway WS (3001) déjà durci (GHSA-5wcw-8jjv-m286).

> **Décision conservée :** `DEFAULT_HOST` **reste `0.0.0.0`** — le mesh fleet (hub de flotte `203.0.113.10:3000`) en dépend. Le durcissement passe par CORS + validation d'origine WS, pas par le bind.

## 2. Ordre des contrôles de confirmation (audit 0.2)

- **`src/utils/confirmation-service.ts`** — ajout d'un **contrôle de refus en amont du permission-mode** : un mode restrictif (`plan`) ne peut plus être contourné par `CODEBUDDY_AUTO_CONFIRM=true` ni par un verdict PolicyEngine `allow`. (PolicyEngine vérifié : `shell:safe` → allow, `fs:write:scoped` → allow au risque faible.)
- **`tests/utils/confirmation-service.test.ts`** — test de non-régression : *« plan mode + AUTO_CONFIRM ne doit pas autoriser une écriture »*.

## 3. Garde-fous de sécurité divers (audit 1.x)

- **`src/security/permission-modes.ts`** — `logger.warn` bien visible lors du passage en `bypassPermissions` (1.1).
- **`src/utils/confirmation-service.ts`** — `setLargeChangeThreshold()` borné à `[1, 10000]` (impossible de désactiver le garde-fou) (1.2).
- **`src/security/declarative-rules.ts`** — garde anti-ReDoS dans `patternToRegex()` : un pattern > 500 caractères est refusé et compile vers une regex qui ne matche jamais (1.3).
- **`src/fleet/peer-tool-bridge.ts`** — `logger.error` au boot si `CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT` est absent (le *fail-closed* devient visible) (1.4).
- **`src/memory/adapters/network-memory-adapters.ts`** — remplacement de 5 `as any` par des formes typées (1.6).
- **`src/agent/specialized/swe-agent-adapter.ts`** — validation que `llmCall`/`executeTool` sont bien des fonctions avant cast (1.7).

## 4. Dépendances & version (audit 0.3 / 0.5)

- **`cowork/package.json`** — `ws` → `^8.20.1` ; ajout d'overrides `vite ^7.3.3`, `tar ^7.5.15`, `ws` (les overrides racine ne propagent pas aux deps directes de Cowork).
- **`package.json`** — version racine `1.0.0-rc.5` → `1.0.0-rc.8` (alignée sur Cowork / `CLAUDE.md` / `CHANGELOG.md`).
- **`.github/workflows/ci.yml`** — ajout d'une étape `npm rebuild better-sqlite3` pour que les ~200 tests DB ne soient plus silencieusement skippés en CI (1.10).

## 5. Suite de tests rouge → verte (audit 0.4 + 39 rouges)

- **Bug source réel — `src/agent/tool-handler.ts`** : le hook de cycle de vie `before-tool-call` n'était pas protégé (contrairement à ses voisins pre-bash / post-bash). Un hook qui *throw* faisait échouer tout l'outil. Enveloppé dans un `try/catch` → dégradation gracieuse (`logger.warn`).
- **Caractérisation :** les 39 tests rouges étaient **pré-existants** (prouvé par isolation `git stash`), majoritairement dus à des mocks `executeHooks` retournant `undefined` au lieu d'un tableau → `for..of` « not iterable ».
- **Corrections de mocks / tests :** `codebuddy-agent.test.ts`, `agent-core.test.ts`, `ocr-tool.test.ts`, `agent-repair-integration.test.ts`, `browser-watchdog.test.ts`, `browser-operator-consent.test.ts`, `sidebar.test.ts` (ajout d'un mock `theme-context`).

## 6. Migration de typage strict (audit 2.6)

- **`tsconfig.json`** — `noUncheckedIndexedAccess` activé (**ON**).
- **529 fichiers migrés** : `3423 → 0` erreurs de type, **0 `!` aveugle ajouté** (audité via `git diff`), **zéro régression de tests** (suite identique avant/après).

> Le second flag `exactOptionalPropertyTypes` reste **OFF** (ciblé pour une itération ultérieure).

## 7. Parité provider & qualité (audit 3.x)

- **`src/codebuddy/providers/provider-gemini-native.ts`** — ajout d'un circuit-breaker (`withCircuitBreaker`, gated par `opts.circuitBreaker`, off par défaut) + parsing best-effort des headers de rate-limit (avec garde défensif sur `headers.forEach`) (3.1).
- **`src/config/model-tools.ts`** — ajout du pattern `o4*` (sinon fallback à 4096 max output) (3.2).
- **`src/providers/codex-oauth.ts`** — `console.*` → `logger.*` (couche core, convention espionnée par les tests) (3.3).

## 8. Cowork & hygiène repo (audit 3.5 / 3.6 / 3.7)

- **`cowork/src/main/index.ts`** — DevTools ouverts uniquement si `isDev` / `COWORK_DEVTOOLS` ; garde d'entrée sur `workspace.readDir` (path-traversal).
- **`.gitignore`** — `*.traineddata` (5 Mo), `scratch/`, binaire `src/desktop-automation/*.exe` (non commité).
- **`tests/README.md`** — seuil de couverture aligné (80 % → 70 %) avec la config réelle.

---

## Vérification finale

```bash
npm run typecheck   # 0 erreur
npm run lint        # 0 erreur
npm test            # 986 fichiers / 29 116 passants / 0 échec / 88 skips
```

## Reste pour la GA (non bloquant — voir AUDIT-2026-05-29.md)

- La feature **self-improve** (`CODEBUDDY_AUTO_CONFIRM` / `self_improvement`) a été **auditée et durcie** côté permission-bypass, mais nécessite une **revue de sécurité dédiée** avant la GA.
- Phases 2-4 de l'audit (circular deps, god files, RAG LRU, spikes MCP/voice/i18n) : dette différée, documentée dans l'audit.
