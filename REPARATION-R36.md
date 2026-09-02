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
- **Commit** : [COMMIT_HASH_TROU_1]

### Trou 2
- **Fichier de test** : 
- **Sortie ROUGE initiale** :
- **Analyse et correction** (`fichier:ligne`) :
- **Sortie VERT** :
- **Vérification suite & tsc** :
- **Commit** :

### Trou 3
- **Fichier de test** : 
- **Sortie ROUGE initiale** :
- **Analyse et correction** (`fichier:ligne`) :
- **Sortie VERT** :
- **Vérification suite & tsc** :
- **Commit** :

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
