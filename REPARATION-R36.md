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
- **Commit** : `22812aa6f`

### Trou 4
- **Fichier de test** : `tests/context/revue-gemini-segment-archive-hash.test.ts`
- **Sortie ROUGE initiale** :
```text
 FAIL  tests/context/revue-gemini-segment-archive-hash.test.ts > Mission G1 — Trou 4 : segment archivé puis restauré avec un hachage différent > SegmentArchive.get doit lever SegmentIntegrityError si le segment sur disque a un segmentId différent du hash demandé
AssertionError: expected function to throw an error, but it didn't
 ❯ tests/context/revue-gemini-segment-archive-hash.test.ts:58:52
     56|     // doit impérativement lever SegmentIntegrityError, et NON renvoye…
     57|     // ACTUELLEMENT : get() fait `if (record.segmentId !== segmentId) …
     58|     expect(() => archive.get(sessionId, targetId)).toThrow(SegmentInte…
       |                                                    ^
     59|
     60|     // ContextExpandTool doit également signaler une erreur d'intégrité
```
- **Analyse et correction** (`fichier:ligne`) :
  - `src/context/segment-archive.ts:134` : dans `SegmentArchive.get`, suppression du court-circuit `record.segmentId !== segmentId` renvoyant `null` afin de laisser `assertRecordIntegrity(record, segmentId)` lever `SegmentIntegrityError`.
  - `src/tools/context-expand-tool.ts:30,39` : dans `ContextExpandTool`, autoriser l'exécution sans condition sur `CODEBUDDY_CONTEXT_ZOOM` lorsqu'une instance d'archive est injectée explicitement dans le constructeur (`explicitArchive`).
- **Sortie VERT** :
```text
 RUN  v4.1.9 /home/patrice/DEV/cb-verif-d-2026-09-02

 Test Files  1 passed (1)
      Tests  2 passed (2)
   Start at  20:43:55
   Duration  315ms (transform 139ms, setup 32ms, import 104ms, tests 69ms, environment 0ms)
```
- **Vérification suite & tsc** :
  - `tests/tools/context-expand.test.ts tests/context/segment-integrity.test.ts` : 7 passed (2 files)
  - `tests/unit/context-manager-v2.test.ts tests/unit/context-manager-v3.test.ts tests/context-manager-v2.test.ts` : 95 passed (3 files)
  - `tests/context` : 52 passed, 4 failed (restants : trous 5 à 8)
  - `npx tsc --noEmit -p .` : exit code 0
- **Commit** : `7e90ca3ea`

### Trou 5
- **Fichier de test** : `tests/context/revue-gemini-owns-compaction-bypass.test.ts`
- **Sortie ROUGE initiale** :
```text
 FAIL  tests/context/revue-gemini-owns-compaction-bypass.test.ts > Mission G1 — Trou 5 : ownsCompaction et moteur de plugin court-circuitant les gardes > prepareMessages doit refuser un assemblage où ownsCompaction a supprimé les consignes système
AssertionError: System prompt must be preserved even when plugin engine owns compaction: expected false to be true // Object.is equality

- Expected
+ Received

- true
+ false

 ❯ tests/context/revue-gemini-owns-compaction-bypass.test.ts:67:98
     65|     const prepared = manager.prepareMessages(messages);
     66|     const hasSystem = prepared.some(m => m.role === 'system');
     67|     expect(hasSystem, 'System prompt must be preserved even when plugi…
       |                                                                                                  ^
     68|
     69|     manager.dispose();

 FAIL  tests/context/revue-gemini-owns-compaction-bypass.test.ts > Mission G1 — Trou 5 : ownsCompaction et moteur de plugin court-circuitant les gardes > prepareMessages doit vérifier assertFitsTokenLimit pour un moteur non-owning
AssertionError: expected function to throw an error, but it didn't
 ❯ tests/context/revue-gemini-owns-compaction-bypass.test.ts:90:53
     88|     // ACTUELLEMENT : la garde assertFitsTokenLimit n'est appelée QUE …
     89|     // et pas du tout dans la branche non-owning (lignes 617-621) !
     90|     expect(() => manager.prepareMessages(messages)).toThrow(ContextCom…
       |                                                     ^
     91|
     92|     manager.dispose();
```
- **Analyse et correction** (`fichier:ligne`) :
  - `src/context/context-manager-v2.ts:25,620-645` : import de `repairToolCallPairs` et ajout d'un finaliseur `finalizeEngineMessages` pour les assemblages retournés par les moteurs de contexte (qu'ils soient `ownsCompaction: true` ou `ownsCompaction: false`). Il réinjecte les prompts système manquants issus de l'original, répare les paires d'outils (`repairToolCallPairs`), vérifie `assertLastUserPreserved`, applique `assertFitsTokenLimit` (qui manquait dans la branche non-owning) et met à jour `lastTokenCount`.
- **Sortie VERT** :
```text
 RUN  v4.1.9 /home/patrice/DEV/cb-verif-d-2026-09-02

 Test Files  1 passed (1)
      Tests  2 passed (2)
   Start at  20:45:32
   Duration  739ms (transform 400ms, setup 30ms, import 511ms, tests 112ms, environment 0ms)
```
- **Vérification suite & tsc** :
  - `tests/unit/context-manager-v2.test.ts tests/unit/context-manager-v3.test.ts tests/context-manager-v2.test.ts` : 95 passed (3 files)
  - `tests/context` : 53 passed, 3 failed (restants : trous 6 à 8)
  - `npx tsc --noEmit -p .` : exit code 0
- **Commit** : `9df7093ba`

### Trou 6
- **Fichier de test** : `tests/context/revue-gemini-multimodal.test.ts`
- **Sortie ROUGE initiale** :
```text
 FAIL  tests/context/revue-gemini-multimodal.test.ts > Mission G1 — Trou 6 : cas multimodal ignoré lors du comptage et de la compaction > ContextManagerV3 doit compter les tokens du texte contenu dans un message multimodal
AssertionError: ContextManagerV3 ignored multimodal text content and counted only 7 tokens: expected 7 to be greater than 500
 ❯ tests/context/revue-gemini-multimodal.test.ts:32:7
     30|       stats.totalTokens,
     31|       `ContextManagerV3 ignored multimodal text content and counted on…
     32|     ).toBeGreaterThan(500);
       |       ^
     33|
     34|     manager.dispose();

 FAIL  tests/context/revue-gemini-multimodal.test.ts > Mission G1 — Trou 6 : cas multimodal ignoré lors du comptage et de la compaction > ContextManagerV3.prepareMessages ne doit pas laisser passer une requête multimodale qui dépasse le budget réel
AssertionError: expected [Function] to throw an error

- Expected:
null

+ Received:
undefined

 ❯ tests/context/revue-gemini-multimodal.test.ts:56:68
     54|     // ACTUELLEMENT : comme le comptage renvoie ~3 tokens, rejectIfCur…
     55|     // et la requête géante passe sans erreur !
     56|     expect(() => manager.prepareMessages([hugeMultimodalMessage])).toT…
       |                                                                    ^
     57|
     58|     manager.dispose();
```
- **Analyse et correction** (`fichier:ligne`) :
  - `src/context/context-manager-v3.ts:17,101,186` : import de `estimateImageUrlTokens`, prise en charge de `Array.isArray(msg.content)` dans le mappage vers `TokenCounter` et ajout des tokens d'images estimés (`estimateImageUrlTokens`) dans `countMessageTokens` et `getStats`.
  - `src/context/compression.ts:9,147` : import de `estimateImageUrlTokens` et prise en charge des contenus multimodaux et images dans `countTotalTokens` et `countSingleMessageTokens`.
- **Sortie VERT** :
```text
 RUN  v4.1.9 /home/patrice/DEV/cb-verif-d-2026-09-02

 Test Files  1 passed (1)
      Tests  2 passed (2)
   Start at  20:47:24
   Duration  843ms (transform 448ms, setup 25ms, import 585ms, tests 115ms, environment 0ms)
```
- **Vérification suite & tsc** :
  - `tests/unit/context-manager-v2.test.ts tests/unit/context-manager-v3.test.ts tests/context-manager-v2.test.ts` : 95 passed (3 files)
  - `tests/context` : 54 passed, 2 failed (restants : trous 7 et 8)
  - `npx tsc --noEmit -p .` : exit code 0
- **Commit** : `077c7ab22`

### Trou 7
- **Fichier de test** : `tests/context/revue-gemini-missing-system.test.ts`
- **Sortie ROUGE initiale** :
```text
 FAIL  tests/context/revue-gemini-missing-system.test.ts > Mission G1 — Trou 7 : gestion défaillante des messages système > ContextCompressor doit préserver l'intégralité des messages système multiples lors de la compression
AssertionError: ContextCompressor kept only 1 system messages out of 3; subsequent system prompts were discarded: expected 1 to be 3 // Object.is equality

- Expected
+ Received

- 3
+ 1

 ❯ tests/context/revue-gemini-missing-system.test.ts:34:7
     32|       survivingSystemMessages.length,
     33|       `ContextCompressor kept only ${survivingSystemMessages.length} s…
     34|     ).toBe(3);
       |       ^
     35|   });
     36|

 FAIL  tests/context/revue-gemini-missing-system.test.ts > Mission G1 — Trou 7 : gestion défaillante des messages système > ContextManagerV2 ne doit pas injecter un message rôle system dans une conversation qui n'en a aucun
AssertionError: ContextManagerV2 injected synthetic role:system messages into a system-less conversation: expected 1 to be +0 // Object.is equality

- Expected
+ Received

- 0
+ 1

 ❯ tests/context/revue-gemini-missing-system.test.ts:68:7
     66|       systemMessagesInPrepared.length,
     67|       'ContextManagerV2 injected synthetic role:system messages into a…
     68|     ).toBe(0);
       |       ^
     69|
     70|     manager.dispose();
```
- **Analyse et correction** (`fichier:ligne`) :
  - `src/context/compression.ts:63-87,117-122,188-216` : dans `ContextCompressor.compress` et `hardTruncate`, remplacer le filtrage conservant uniquement le premier message système par la préservation intégrale de tous les messages système (`filter(m => m.role === 'system')`) en maintenant leur ordre initial.
  - `src/context/context-manager-v2.ts:787,830,897,930` : propager `hasOriginalSystem` depuis `prepareMessagesLegacy` à `applyStrategies` et `applySlidingWindow`, et n'émettre le marqueur synthétique `{ role: 'system', content: '[Previous ...]' }` que si la conversation comportait originellement des messages système.
- **Sortie VERT** :
```text
 RUN  v4.1.9 /home/patrice/DEV/cb-verif-d-2026-09-02

 Test Files  1 passed (1)
      Tests  2 passed (2)
   Start at  20:50:30
   Duration  1.58s (transform 868ms, setup 43ms, import 1.11s, tests 258ms, environment 0ms)
```
- **Vérification suite & tsc** :
  - `tests/context/segment-archive.test.ts tests/context-manager-v2.test.ts` : 28 passed (2 files)
  - `tests/unit/context-manager-v2.test.ts tests/unit/context-manager-v3.test.ts tests/context-manager-v2.test.ts` : 95 passed (3 files)
  - `tests/context` : 55 passed, 1 failed (restant : trou 8)
  - `npx tsc --noEmit -p .` : exit code 0
- **Commit** : [COMMIT_HASH_TROU_7]

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
