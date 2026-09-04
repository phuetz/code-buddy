# Réparation DGM4 — nouveauté AST et pénalité de descendance

Date : 2026-09-04

## Périmètre

Implémenter le filtre de nouveauté syntaxique AST avant évaluation (proposition 1)
et la sélection de parents avec pénalité de descendance (proposition 3) de l’audit DGM2.

## Journal

- Rapport créé avant inspection du dépôt.
- Inspection effectuée et réservation Fable 5 inscrite.
- Réservation commitée dans `1cc9cae84` après le commit du rapport `60b063ccc`.

## R1 — nouveauté AST avant évaluation

`ast-novelty.ts` compare les nœuds produits par TypeScript, sans trivia, et trie les imports avant
la comparaison. Le moteur applique cette porte G0 avant `scoreBranchInWorktree`; le tool-gate accepte
un `parentCode` optionnel et applique le même G0 avant G1. Une identité AST est rejetée avec
`rejectionReason: 'ast-identical'`. Les rejets du moteur incrémentent `stats.evaluationsAvoided` dans
`variants.json`. En cas d’erreur de lecture/parsing, le contrôle s’ouvre pour ne jamais rejeter une
mutation non prouvée identique.

Rouge : les deux nouveaux modules manquaient, soit 1 suite non collectée et 2 tests R2 rouges.
Vert intermédiaire : `ast-novelty.test.ts` + `parent-selection.test.ts` = 2 fichiers / 7 tests.

Commit R1 : à compléter après la vérification ciblée.

## Preuves

À compléter après les tests ciblés, `tsc`, ESLint ciblé et `git diff --check`.

## Commits

À compléter après chaque point R1/R2 et les vérifications finales.
