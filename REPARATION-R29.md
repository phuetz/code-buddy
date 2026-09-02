# Réparation R29 — compaction de contexte

Date : 2026-09-02
Dépôt : `/home/patrice/DEV/cb-repar-context-2026-09-02`
Branche : `fix/repar-context-2026-09-02`

Ce rapport est créé **avant** les correctifs, conformément à la mission.
`docs/FABLE5-CODEX-COORDINATION.md` est lu et volontairement inchangé.
Aucun LLM réel, aucun réseau. Résumeur extractif uniquement.

## Vérification des D au code

Tous les D de `AUDIT-A-REPARER.md` sont **vrais** (aucun D faux) :

| D | Verdict | Preuve dans le source |
|---|---|---|
| D1 | **vrai** | `prepareMessagesEnhanced()` (`src/context/context-manager-v2.ts` ~534-539) accepte un tableau non vide sous budget **sans** vérifier que le dernier `user` est encore là. `EnhancedContextCompressor.removeByImportance` / `hardTruncate` peuvent le jeter. |
| D2 | **vrai** | `prepareMessagesLegacy()` réinsère les `system` **après** `applyStrategies()` calé sur `effectiveLimit` entier (~590-614). Aucune postcondition `tokens <= limit`. Le journal annonce « Auto-compact: Reduced » même hors budget. |
| D3 | **vrai** | `lastEnhancedResult = result` (~521-522) **avant** le garde de repli. `getCompressionStats()` / `getLastCompressionMetrics()` lisent encore cette tentative rejetée (~1311-1320). |
| D4 | **vrai** | `forceCleanup()` (~1126-1144) vide `summaries` et `enhancedCompressor.clearArchives()` mais **ne** met **pas** `lastEnhancedResult` à `null`. `dispose()` non plus (~1070-1076). `getLastCompressionResult()` retient `fullContextArchive`. |
| D5 | **vrai** | `SegmentArchive.archive()` (~66-70) réutilise un fichier existant sans le lire. `get()` / `readRecord()` (~108-176) ne recalculent pas `sha256(messages)`. `context_expand` injecte le contenu si la forme JSON est valide. |

Pistes de l'audit (compteur Enhanced vs `updateConfig`, `list()` masquant les valides, snapshot périodique, `purgeLru`) : **non traitées**, hors périmètre des cinq D.

## Correctifs prévus (un commit par D)

1. D1 — dernier message utilisateur inviolable ; s'il dépasse seul le budget, `ContextCompactionError`.
2. D2 — compaction qui ne tient pas sous la limite → `ok: false` / exception typée ; jamais de succès journalisé hors budget.
3. D3 — statistiques = résultat réellement envoyé (repli inclus).
4. D4 — `forceCleanup()` / `dispose()` libèrent `lastEnhancedResult`.
5. D5 — `get()` / `context_expand` recalculent le hash et refusent un segment altéré.

## Preuves

### D1 — requête courante inviolable

Test rouge avant correctif (`tests/context/compaction-current-request.test.ts`) :

```text
❯ tests/context/compaction-current-request.test.ts (3 tests | 2 failed) 544ms
     × throws when the last user message alone exceeds the context window
     × keeps a multimodal last user message that is followed by tool turns
AssertionError: The instanceof assertion needs a constructor but undefined was given.
Expected: LATEST_REQUEST multimodal
Received: "history 16: zzzzz…"
Tests  2 failed | 1 passed (3)
```

Correctif : `ContextCompactionError` (`ok: false`) ; le dernier `user` n'est jamais tronqué
ni omis (repli legacy + réinsertion) ; s'il dépasse seul le budget, l'exécuteur
refuse l'appel fournisseur au lieu d'envoyer un contexte hors sujet.

Test vert :

```text
npx vitest run tests/context/compaction-current-request.test.ts
Test Files  1 passed (1)
Tests  3 passed (3)
```

`tests/context/` après D1 : **40 passed, 598 passed**.

`tsc --noEmit` : exit 0. `eslint src/context/context-manager-v2.ts src/agent/execution/agent-executor.ts tests/context/compaction-current-request.test.ts` : exit 0.

## Bilan

(à compléter en fin de mission)
