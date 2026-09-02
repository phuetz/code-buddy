# Mission R36 — Rapport de réparation : combler les 8 trous logiques de gestion de contexte (Revue Gemini G1)

Date de début : 2026-09-02
Dépôt : `~/DEV/cb-verif-d-2026-09-02`
Branche : `fix/trous-contexte-2026-09-02`

## 1. Journal des lectures et commandes

### Lectures initiales
- `REVUE-CONTEXTE-GEMINI.md` : lu en entier, analyse des 8 trous logiques et scenarios.
- `src/context/transcript-repair.ts` : lu en entier, analyse de `repairToolCallPairs`.
- `src/context/segment-archive.ts` : lu en entier, analyse de `SegmentArchive.get` et intégrité.
- `src/context/context-manager-v3.ts` : lu en entier, analyse de `prepareMessages`, `updateConfig`, comptage tokens.
- `src/context/context-manager-v2.ts` : lu (sections clés : `DEFAULT_CONFIG`, `prepareMessages`, `ownsCompaction`, `applySlidingWindow`, `applySummarization`, `updateConfig`).
- `src/agent/execution/agent-executor.ts` : lu (les 3 sites de compaction L1338, L1489, L1861).
- `src/agent/execution/context-pipeline.ts` : lu (`prepareTurnMessages`, `compactTurnMessagesInPlace`).
- `CLAUDE.md` : lu (règle L77 sur la troncature du prompt système à 50% et hard cap 32K).

---
## 2. État initial du dépôt
- Branche active : `fix/trous-contexte-2026-09-02`
- Commit de départ : `d0006cbf8` (Mission G1 - Trou 8)

---
## 3. Traitement des 8 trous logiques

### Trou 1
- **Fichier de test** : `tests/context/revue-gemini-orphan-tool-result.test.ts`
- **Sortie ROUGE initiale** :
```text
 FAIL  tests/context/revue-gemini-orphan-tool-result.test.ts > Mission G1 — Trou 1 : requête courante refusée ou compactée laissant un tool_result orphelin > ContextCompressor ne doit jamais conserver un tool_result si son appel assistant tool_calls a été supprimé
AssertionError: Orphan tool_result found for callId "call_read_1" without calling assistant tool_calls: expected false to be true // Object.is equality

- Expected
+ Received

- true
+ false

 ❯ tests/context/revue-gemini-orphan-tool-result.test.ts:50:117
     48|         m => m.role === 'assistant' && 'tool_calls' in m && Array.isAr…
     49|       );
     50|       expect(hasParentCall, `Orphan tool_result found for callId "${ca…
       |                                                                                      ^
     51|     }
     52|   });

 FAIL  tests/context/revue-gemini-orphan-tool-result.test.ts > Mission G1 — Trou 1 : requête courante refusée ou compactée laissant un tool_result orphelin > ContextManagerV3.prepareMessages ne doit pas émettre un transcript contenant un tool_result orphelin
AssertionError: ContextManagerV3 emitted orphan tool_result call_exec_42: expected false to be true // Object.is equality

- Expected
+ Received

- true
+ false

 ❯ tests/context/revue-gemini-orphan-tool-result.test.ts:91:80
     89|         m => m.role === 'assistant' && 'tool_calls' in m && Array.isAr…
     90|       );
     91|       expect(hasCall, `ContextManagerV3 emitted orphan tool_result ${c…
       |                                                                                ^
     92|     }
     93|     manager.dispose();
```
- **Analyse et correction** (`fichier:ligne`) :
  - `src/context/compression.ts:11` : import de `repairToolCallPairs`.
  - `src/context/compression.ts:91,135` : application de `repairToolCallPairs` aux messages issus de `tool_truncation` et `sliding_window`.
  - `src/context/compression.ts:219` : application de `repairToolCallPairs` au résultat de `hardTruncate`.
  - `src/context/context-manager-v3.ts:22,151` : import et appel de `repairToolCallPairs` dans `prepareMessages` lorsque le transcript est déjà sous le budget.
- **Sortie VERT** :
```text
 RUN  v4.1.9 /home/patrice/DEV/cb-verif-d-2026-09-02

 Test Files  1 passed (1)
      Tests  2 passed (2)
   Start at  20:38:00
   Duration  706ms (transform 399ms, setup 23ms, import 505ms, tests 100ms, environment 0ms)
```
- **Vérification suite & tsc** :
  - `tests/unit/context-manager-v3.test.ts tests/unit/context-manager-v2.test.ts tests/context-manager-v2.test.ts` : 95 passed (3 files)
  - `tests/agent` : 2617 passed (197 files)
  - `tests/context` : 48 passed, 7 failed (restants : trous 2 à 8)
  - `npx tsc --noEmit -p .` : exit code 0
- **Commit** : `a889e97ac`

### Trou 2
- **Fichier de test** : `tests/context/revue-gemini-lost-tool-call.test.ts`
- **Sortie ROUGE initiale** :
```text
 FAIL  tests/context/revue-gemini-lost-tool-call.test.ts > Mission G1 — Trou 2 : compaction qui perd un tool_call sans son résultat > EnhancedContextCompressor.hardTruncate ne doit jamais conserver un assistant tool_calls dont le tool_result a été tronqué
AssertionError: Compaction preserved tool_call "call_deploy_42" but dropped its corresponding tool_result, creating an invalid LLM transcript: expected false to be true // Object.is equality

- Expected
+ Received

- true
+ false

 ❯ tests/context/revue-gemini-lost-tool-call.test.ts:61:11
     59|           hasResult,
     60|           `Compaction preserved tool_call "${call.id}" but dropped its…
     61|         ).toBe(true);
       |           ^
     62|       }
     63|     }

 FAIL  tests/context/revue-gemini-lost-tool-call.test.ts > Mission G1 — Trou 2 : compaction qui perd un tool_call sans son résultat > EnhancedContextCompressor avec multi-tool ne doit pas conserver un tool_call partiel sans son résultat
AssertionError: Tool result for call_beta_2 must not be dropped while assistant tool_call is kept: expected undefined to be defined
 ❯ tests/context/revue-gemini-lost-tool-call.test.ts:123:109
    121|       m => m.role === 'tool' && (m as { tool_call_id?: string }).tool_…
    122|     );
    123|     expect(betaResult, 'Tool result for call_beta_2 must not be droppe…
       |                                                                                                             ^
    124|   });
    125| });
```
- **Analyse et correction** (`fichier:ligne`) :
  - `src/context/enhanced-compression.ts:28` : import de `repairToolCallPairs`.
  - `src/context/enhanced-compression.ts:256` : appel de `repairToolCallPairs(compressed)` dans `EnhancedContextCompressor.compress` pour garantir la réparation post-compaction (synthèse de résultat pour les tool_calls orphelins).
- **Sortie VERT** :
```text
 RUN  v4.1.9 /home/patrice/DEV/cb-verif-d-2026-09-02

 Test Files  1 passed (1)
      Tests  2 passed (2)
   Start at  20:40:18
   Duration  640ms (transform 326ms, setup 26ms, import 417ms, tests 106ms, environment 0ms)
```
- **Vérification suite & tsc** :
  - `tests/unit/context-manager-v2.test.ts tests/unit/context-manager-v3.test.ts tests/context-manager-v2.test.ts` : 95 passed (3 files)
  - `tests/context` : 50 passed, 6 failed (restants : trous 3 à 8)
  - `npx tsc --noEmit -p .` : exit code 0
- **Commit** : `1cbaca13e`

### Trou 3
- **Fichier de test** : `tests/context/revue-gemini-wrong-model-budget.test.ts`
- **Sortie ROUGE initiale** :
```text
 FAIL  tests/context/revue-gemini-wrong-model-budget.test.ts > Mission G1 — Trou 3 : budget compté sur le mauvais modèle > ContextManagerV2.updateConfig doit aligner maxContextTokens sur la fenêtre du nouveau modèle
AssertionError: effectiveLimit remains stuck at 120627 instead of scaling to 1M model window: expected 120627 to be greater than 500000
 ❯ tests/context/revue-gemini-wrong-model-budget.test.ts:30:7
     28|       manager.effectiveLimit,
     29|       `effectiveLimit remains stuck at ${manager.effectiveLimit} inste…
     30|     ).toBeGreaterThan(500_000);
       |       ^
     31|
     32|     manager.dispose();

 FAIL  tests/context/revue-gemini-wrong-model-budget.test.ts > Mission G1 — Trou 3 : budget compté sur le mauvais modèle > ContextManagerV3.updateConfig doit recalculer la limite de contexte lors du changement de modèle
AssertionError: ContextManagerV3.getStats maxTokens remains stuck at 8192 instead of 1M: expected 8192 to be greater than 500000
 ❯ tests/context/revue-gemini-wrong-model-budget.test.ts:48:7
     46|       stats.maxTokens,
     47|       `ContextManagerV3.getStats maxTokens remains stuck at ${stats.ma…
     48|     ).toBeGreaterThan(500_000);
       |       ^
     49|
     50|     manager.dispose();
```
- **Analyse et correction** (`fichier:ligne`) :
  - `src/context/context-manager-v2.ts:311,1273` : dans le constructeur et dans `updateConfig`, lorsque `model` est spécifié et `maxContextTokens` non fourni, aligner `maxContextTokens`, `responseReserveTokens` et `autoCompactThreshold` sur la fenêtre déclarée du modèle (`getModelToolConfig(model).contextWindow`), et réinstancier `enhancedCompressor` avec le nouveau `tokenCounter`.
  - `src/context/context-manager-v3.ts:56,72` : dans le constructeur et dans `updateConfig`, recalculer `maxContextTokens` et `responseReserveTokens` selon `getModelToolConfig(model).contextWindow`.
- **Sortie VERT** :
```text
 RUN  v4.1.9 /home/patrice/DEV/cb-verif-d-2026-09-02

 Test Files  1 passed (1)
      Tests  2 passed (2)
   Start at  20:41:49
   Duration  708ms (transform 453ms, setup 23ms, import 580ms, tests 6ms, environment 0ms)
```
- **Vérification suite & tsc** :
  - `tests/unit/context-manager-v2.test.ts tests/unit/context-manager-v3.test.ts tests/context-manager-v2.test.ts` : 95 passed (3 files)
  - `tests/context` : 51 passed, 5 failed (restants : trous 4 à 8)
  - `npx tsc --noEmit -p .` : exit code 0
- **Commit** : [COMMIT_HASH_TROU_3]

### Trou 4
- **Fichier de test** : 
- **Sortie ROUGE initiale** :
- **Analyse et correction** (`fichier:ligne`) :
- **Sortie VERT** :
- **Vérification suite & tsc** :
- **Commit** :

### Trou 5
- **Fichier de test** : 
- **Sortie ROUGE initiale** :
- **Analyse et correction** (`fichier:ligne`) :
- **Sortie VERT** :
- **Vérification suite & tsc** :
- **Commit** :

### Trou 6
- **Fichier de test** : 
- **Sortie ROUGE initiale** :
- **Analyse et correction** (`fichier:ligne`) :
- **Sortie VERT** :
- **Vérification suite & tsc** :
- **Commit** :

### Trou 7
- **Fichier de test** : 
- **Sortie ROUGE initiale** :
- **Analyse et correction** (`fichier:ligne`) :
- **Sortie VERT** :
- **Vérification suite & tsc** :
- **Commit** :

### Trou 8
- **Fichier de test** : 
- **Sortie ROUGE initiale** :
- **Analyse et correction** (`fichier:ligne`) :
- **Sortie VERT** :
- **Vérification suite & tsc** :
- **Commit** :

---
## 4. Synthèse et état final
- **Tests contexte & régression** :
- **`npx tsc --noEmit -p .`** :
- **Ce qui reste ouvert** :
