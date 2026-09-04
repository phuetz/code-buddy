# REPARATION-DELEGVERIF — vérification adversariale du verdict NVIDIA sur DELEG3

- **Lane** : DELEGVERIF
- **Ouvert le** : 2026-09-04, avant toute inspection du code.
- **Clone** : `~/DEV/cb-delegverif-2026-09-04`, branche `fix/delegverif-2026-09-04`, issue de `codex/audit-systeme-nerveux-2026-09-01`.
- **Source du verdict à vérifier** : `docs/reports/2026-09/JUGE-NVIDIA-DELEG3.md` (juge automatique NVIDIA Nemotron 3 Ultra) sur la fusion DELEG3 (`8976a0c5e` QualityGate multiplexé, `c6971eee7` Verifier délégué).
- **Zone réservée** : `src/agent/middleware/quality-gate-middleware.ts`, `src/agent/specialized/agent-registry.ts`, `src/agent/delegation/thread-delegation.ts` et leurs tests.
- **Garde-fous** : HOME temporaire `_qa/delegverif/home` (gitignoré), aucune écriture dans `~/code-buddy` ni dans le vrai `~/.codebuddy`, aucun push, aucune API payante.

## Méthode

Un juge automatique se trompe souvent. Pour chacun des huit points, je lis le code au niveau `fichier:ligne`,
je rends un verdict **VRAI / FAUX / PARTIEL** appuyé sur une preuve (extrait de code ou test exécuté), et :

- si **VRAI** : test qui rougit d'abord, correction minimale, vert, puis mutation du correctif → rouge ;
- si **FAUX** : une phrase d'explication, plus un test de figeage du contrat s'il manquait.

## Contrats à ne pas casser

1. Concurrence par défaut du QualityGate **inchangée** par rapport à l'état d'avant DELEG3 (référence : `git show 8976a0c5e~1:src/agent/middleware/quality-gate-middleware.ts`).
2. Verifier à contexte réellement neuf : aucun message du parent ne doit lui parvenir.
3. Jamais `CONFIRMED` sans oracle.
4. Une gate non requise qui échoue ne bloque pas, si c'était bien le contrat d'avant.
5. Un délégué qui jette ou dépasse son budget ⇒ « revue incomplète », jamais un vert.

## Verdicts

_(à remplir au fil de l'inspection)_

| # | Gravité annoncée | Point | Verdict | Preuve | Suite |
|---|---|---|---|---|---|
| 1 | 🔴 | Résultats mappés avant la fin des délégués | _en cours_ | | |
| 2 | 🔴 | `parentHistory` fuité vers le Verifier délégué | _en cours_ | | |
| 3 | 🔴 | Régression silencieuse de la concurrence par défaut | _en cours_ | | |
| 4 | 🟠 | Coût vérifié après le tour, pas pendant | _en cours_ | | |
| 5 | 🟠 | Budget parent Verifier 12 tours vs 6 attendus | _en cours_ | | |
| 6 | 🟠 | Test `clamps an oversized maxSteps` non contraignant | _en cours_ | | |
| 7 | 🟡 | Gates optionnelles devenues bloquantes sur erreur | _en cours_ | | |
| 8 | 🟡 | Test « budget exhaustion » ne valide pas la concurrence | _en cours_ | | |

## Journal

- 2026-09-04 — ouverture du rapport et réservation de la ligne de coordination, avant lecture du code.
