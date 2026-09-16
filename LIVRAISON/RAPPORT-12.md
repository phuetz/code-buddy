# Mission Grok n° 12 — PR #155 : corrections de la revue de fusion

**STATUT : COMPLET** (push simple de la branche ; pas de fusion)

Branche : `fable/peer-tool-invoke-2026-09-16`
Worktree : `/home/patrice/DEV/cb-peer-tool-invoke-2026-09-16`
PR : https://github.com/phuetz/code-buddy/pull/155
HEAD de départ : `d5513a875`
Revue : `REVUE-OPUS-PR155.md` (verdict NE PAS FUSIONNER)

## Tableau point → action → fichier:ligne → test

| Point revue | Action | Fichier:ligne | Test |
|---|---|---|---|
| 1. `alwaysInclude` change le défaut pour tous | Retiré de `DEFAULT_TOOL_SELECTION_CONFIG`. Inclus seulement si des pairs sont enregistrés (`connectedFleetSurfaceTools`) ou requête flotte (`runtimeInspectionTools`, même surface que `list_peers` / `peer_delegate`). | `src/agent/execution/tool-selection-strategy.ts:136` ; `src/services/runtime-settings-context.ts:70-90` ; `src/agent/execution/agent-executor.ts:1498-1506` | `tests/tools/peer-tool-always-include.test.ts` (défaut vide / requête flotte / pair enregistré) ; `tests/agent/execution/agent-executor.test.ts` (lite sans pair / lite avec pair) |
| 2. API HTTP « arguments bruts des outils » | **Retirée.** Hors recette (recette = CLI deux nœuds `peer_tool_invoke`, pas `/api/chat`). Champ optionnel non documenté, non testé, exposait commandes/jetons. | `src/server/agent-adapter.ts`, `src/server/routes/chat.ts`, `src/server/types.ts` (revenu à origin/main) | Pas de test serveur ajouté : le delta n’existe plus |
| 3. Tableau coordination cassé + ligne dupliquée | En-tête Markdown restauré en tête du tableau ; ligne P1 unique (mission 12) ; ligne vide entre deux rangées du tableau historique retirée ; doublon `peer_tool_invoke` devant HEARTWATCH retiré. Fichier relu. | `docs/FABLE5-CODEX-COORDINATION.md:18-22` et tableau historique HEARTWATCH | Relu ; `git diff --check` 0 |
| 4. Redaction erreurs non reconnues | Fallback `failed: ${message}` et `peer.describe failed` passent par `redactPeerToolInvokeError` (chemins POSIX/Win/`file:`/`~/` puis `redactSecrets`). | `src/tools/peer-tool-invoke-tool.ts` `redactPeerToolInvokeError` + `mapRemoteError` | `tests/tools/peer-tool-invoke-tool.test.ts` : message inconnu avec `/home/peer/workspace/…` ; `describe` avec chemin ; unit secrets |
| 5a. Schéma `enum` vs `TRUST_DESCRIBE` (FAIBLE) | `enum` retiré du schéma LLM / ITool pour que les extras décrits restent appelables. Description liste le trio par défaut. | `src/codebuddy/fleet-tool-defs.ts` ; `src/tools/registry/fleet-tools.ts` | `tests/tools/fleet-tool-validation.test.ts` |
| 5b. CHANGELOG enfoui | Entrée `peer_tool_invoke` déplacée sous le `[Unreleased]` de tête. | `CHANGELOG.md:1-7` | — |
| 5c. Guide `file_path` vs `path` | Exemple `peer_tool_invoke` aligné sur `path` ; redaction des erreurs inconnues documentée. | `docs/fleet-guide.md` | — |
| 5d. Timeout local n’annule pas B | Laissé : `timeoutMs` est déjà transmis à `invokeTool` (revue : acceptable). | — | — |
| 5e. Pas d’intégration réelle A→gates B | Hors corrections courtes ; recette deux nœuds déjà faite mission précédente. | — | — |

## Vérifications

| Commande | Résultat |
|---|---|
| `env -u FORCE_COLOR npx vitest run tests/tools tests/fleet tests/config` | **271 fichiers / 2986 verts / 1 skip / 0 rouge**, 65,70 s |
| Premier passage avec `FORCE_COLOR` | 1 rouge hors lane : `tests/fleet/fleet-listener.test.ts` stderr `NO_COLOR`/`FORCE_COLOR` (préexistant, RAPPORT-11). Isolé vert sans `FORCE_COLOR`. |
| `npx tsc --noEmit -p tsconfig.json` | exit 0, 18,20 s |
| ESLint ciblé `--quiet` | exit 0 |
| `git diff --check` | 0 |

## Choix HTTP

Retrait, pas documentation. La recette publiée (2.1.0 + branche, Ollama `gemma4:12b`, nœuds A/B) n’utilise pas `/api/chat`. Le champ `arguments` n’avait aucun test `tests/server` et exposait les arguments de **tous** les outils.

## Push

Un seul `git push origin fable/peer-tool-invoke-2026-09-16` (non forcé). PR non fusionnée.

## Checks GitHub (`gh pr checks 155`)

*(rempli après l’attente ≤ 25 min)*
