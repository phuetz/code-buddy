# CORRECTION — Bugs surveillance événementielle (audit adverse agy)

Branche : `feat/surveillance-evenementielle-2026-09-05` · Worktree `~/DEV/cb-heartwatch-2026-09-05`
Source : `docs/reports/2026-09/AUDIT-SURVEILLANCE-AGY.md` (commit audité `2a53f459e`).
Début : 2026-09-05. Aucun push. Invariants inchangés (opt-in OFF byte-identique, never-throws, HOME isolé).

## Mapping BUG → correctif → test (rempli au fil)

| BUG | Gravité | Correctif | Test (échouerait AVANT) |
| --- | --- | --- | --- |
| BUG-01 | A | CPU INSTANTANÉ par delta `/proc/<pid>/stat` (utime+stime jiffies) entre 2 passes : `(Δjiffies/clk_tck)/Δt·100`. Snapshot par pid entre passes ; 1re vue = pas de delta. `ps -o pcpu` (moyenne de vie) abandonné. | `tests/sensory/system-vitals-emitter.test.ts` : « detects an OLD process that suddenly spins » + « does NOT flag …high lifetime average but idle ». L'ancien code lisait `cpuPct` injecté (inexistant sur `ProcSample`) ⇒ NaN ⇒ jamais détecté. **Vérifié aussi sur `/proc` RÉEL : bash emballé détecté à 94,6 % instantané via delta 500 ms.** |
| BUG-02 | A | `executeSensoryAction('alert')` propage le retour de `sendTelegramAlert` ; `{ok:false, detail}` + log local si token absent/échec. | `tests/sensory/alert-action.test.ts` : sans token ⇒ `ok:false` (rouge avant), avec token+fetch stub ⇒ `ok:true`, rejet Telegram ⇒ `ok:false`. |
| BUG-03 | A | `filterMatches` : `payloadValue` null/undefined/'' ⇒ `false` AVANT `Number()`. Un vrai `0` matche toujours. | `tests/sensory/sensory-rules-engine.test.ts` : « null … does NOT match lte/eq/gte » + garde de régression « a real 0 still matches ». |
| BUG-04 | A | Cadence par défaut 60→20 battements (sous-minute) ; modèle `codex-quota-probe` en fenêtre `between:['04:20','04:22']` au lieu d'égalité stricte `hhmm`. | `tests/sensory/schedule-emitter.test.ts` : même gigue 60 s ⇒ l'égalité stricte rate (0 match), la fenêtre capte (≥1). |
| BUG-05 | B | Garde PID-reuse : delta ignoré si `startTime` diffère ou si le process a « rajeuni » ⇒ compteur réinitialisé, nouvelle base, pas de comptage. | `system-vitals` : « a reused pid does not inherit the previous counter ». |
| BUG-06 | B | Lecteur renvoie `null` sur échec ; la passe saute la section runaway SANS purger les compteurs (seul un `[]` valide purge). | `system-vitals` : « a null read keeps the consecutive counter intact ». |
| BUG-07 | B | Documenté : `user` requis pour les orphelins reparentés à PID 1 (`server` s'arrête à l'arbre du serveur). | doc `surveillance-evenementielle.md` + `CLAUDE.md`. |
| BUG-08 | C | `resolveIgnoreComm` distingue non-défini de vide : env `CODEBUDDY_RUNAWAY_IGNORE_COMM=""` ⇒ liste vide (rien ignoré). | `system-vitals` : « CODEBUDDY_RUNAWAY_IGNORE_COMM="" empties the list ». |
| BUG-09 | C | `isIgnoredComm` : match EXACT (`includes`), plus de `startsWith`. | `system-vitals` : « "nodemapper" is NOT immunized by "node" » + « the exact comm IS ignored ». |
| BUG-10 | C | `iso` via `now.toISOString()` (ISO-8601 UTC). | `schedule-emitter` : `iso` typé chaîne (contrat), rendu ISO. |

## Bilan tranché
**PUSHABLE** : les 4 bloquants (A) sont fermés, chacun avec un test qui aurait échoué AVANT
(BUG-01 prouvé sur `/proc` réel, BUG-02/03/04 rouge→vert). B/C corrigés et testés. Suite sensory
79 fichiers / 741 tests (0 régression). `tsc` 0, ESLint ciblé 0, `git diff --check` 0. Aucun push.
