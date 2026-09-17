# Mission Grok n° 14 — PR #155 : alwaysInclude flotte additive

**STATUT : COMPLET** (correctif, nettoyage, vérifications locales et poussée ; CI PR #155 suivie)

Branche : `fable/peer-tool-invoke-2026-09-16`
Worktree : `cb-peer-tool-invoke-2026-09-16`
HEAD de départ : `b2224c510`
Commits : `f996d0626` (correctif + nettoyage LIVRAISON/doublon) ; commit documentaire portant ce rapport.
PR : https://github.com/phuetz/code-buddy/pull/155
Revue : `REVUE-OPUS-PR155-PASSE2.md` (points passe 1 réglés ; régression `d530a235f`)

## Garde-fous

- Poussée simple sur `fable/peer-tool-invoke-2026-09-16` uniquement, jamais de fusion.
- `git add` nommément. Pas de secret. Pas de `git add -A`.
- Aucun autre changement.

## 1. Diagnostic (fichier:ligne)

`d530a235f` (`src/agent/execution/agent-executor.ts` ~1504) préfixe les outils de flotte dans `alwaysInclude` :

```ts
const existing = selectionOpts.alwaysInclude ?? [];
alwaysInclude: [...inspectionTools, ...existing.filter(...)]
```

`selectToolsForQuery` fusionne `{ ...this.config, ...options }` (`tool-selection-strategy.ts:241`). Dès que `options.alwaysInclude` est défini, il **remplace** `DEFAULT_TOOL_SELECTION_CONFIG.alwaysInclude`.

Sur un modèle standard (pas `lite`, pas introspection, pas compact headless), `selectionOpts.alwaysInclude` est `undefined` → `existing = []` → la liste garantie devient uniquement `list_peers` / `route_peer` / `peer_delegate` / `peer_tool_invoke`. `create_file`, `apply_patch`, `str_replace_editor`, etc. disparaissent à chaque tour, toutes surfaces.

Le test existant utilisait `qwen3:4b-instruct` (`promptProfile: 'lite'`), donc `alwaysInclude` était déjà `['view_file','bash','search']` : il ne voyait pas le remplacement de la liste par défaut. Le doublon `tests/tools/peer-tool-always-include.test.ts` / `tests/agent/execution/peer-tool-always-include.test.ts` ne vérifiait que `connectedFleetSurfaceTools()`.

## 2. Correctif

`mergeAlwaysInclude(existing, extras)` (`src/agent/execution/tool-selection-strategy.ts`) :

- extras vide → `existing` inchangé (`undefined` conserve le défaut de la stratégie) ;
- `existing` unset → extras **ajoutés** à `DEFAULT_TOOL_SELECTION_CONFIG.alwaysInclude` (flotte en tête) ;
- `existing` déjà posé (lite / compact) → extras en tête de cette liste compacte, `bash` conservé.

`agent-executor.ts` l’utilise à la place du `?? []`.

Test non simulé : `ToolSelectionStrategy.selectToolsForQuery` réel + pair enregistré dans le registre → `create_file` / `apply_patch` / `peer_tool_invoke` / `list_peers` présents. Sans pair : `mergeAlwaysInclude` reste `undefined`, défaut inchangé.

## 3. Nettoyage

- `git rm` `LIVRAISON/RAPPORT-12.md` `LIVRAISON/RAPPORT-13.md` ; fichiers non suivis du dossier effacés. Dossier `LIVRAISON/` absent.
- `git rm` `tests/tools/peer-tool-always-include.test.ts` (doublon byte-identique de `tests/agent/execution/peer-tool-always-include.test.ts`).
- Tableau P1 de `docs/FABLE5-CODEX-COORDINATION.md` : statut et HEAD réels, plus de livrable `LIVRAISON/`.

## 4. Vérifications

| Commande | Résultat |
|---|---|
| `env -u FORCE_COLOR npx vitest run tests/agent/execution/peer-tool-always-include.test.ts tests/agent/execution/tool-selection-lite.test.ts` | 2 fichiers / 35 verts |
| `env -u FORCE_COLOR npx vitest run tests/agent/execution/agent-executor.test.ts -t 'peer_tool_invoke\|create_file and apply_patch'` | 3 verts / 142 skip |
| `env -u FORCE_COLOR npx vitest run tests/tools tests/fleet tests/config tests/agent` | **505 fichiers / 5927 verts / 1 skip / 0 rouge**, 103,91 s |
| `npx tsc --noEmit -p tsconfig.json` | exit 0, 19,28 s |
| `npx eslint --quiet` (4 fichiers touchés) | 0 erreur |
| `git diff --check` | 0 |

Poussée : `git push origin fable/peer-tool-invoke-2026-09-16` uniquement.

## STATUT

COMPLET
