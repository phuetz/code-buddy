# Réparation DELEG1

## Journal de preuves

Rapport créé avant toute inspection du dépôt, conformément à la mission.

## Réservation et diagnostic

- Dépôt : `/home/patrice/DEV/cb-deleg1-2026-09-03`.
- Branche : `feat/deleg1-thread-delegation-2026-09-03`.
- Base : `6c6e43b58cf08a54895e21bb968b8af42f2d3ae3`.
- Propriétaire : Codex (GPT-5), réservation inscrite le 03/09/2026.
- État initial suivi : aucun fichier modifié ; non-suivis préexistants `node_modules`
  et présent rapport.
- `HOME` des commandes : `.deleg1-home/` dans le clone.

## Choix d'intégration

Lecture intégrale effectuée avant ce choix :

- `src/agents/` (1 fichier, 139 lignes) ;
- `src/orchestration/` (5 fichiers, 2 062 lignes) ;
- `src/commands/batch*.ts` (le fichier réel est
  `src/commands/handlers/batch-handlers.ts`, 651 lignes) ;
- `src/agent/facades/` (6 fichiers, 1 707 lignes) ;
- référence comparative Apache 2.0 `codex_delegate.rs` (371 lignes), lue sans
  reprise littérale.

Surface retenue : **`/batch`**. Le chemin GK34 appelle aujourd'hui directement
`CodeBuddyClient.chat()` pour chaque unité portant un fichier cible ; seul le
repli sans cible construit un `CodeBuddyAgent`. C'est donc la surface où DELEG1
remplace réellement un simple appel de complétion par un agent autonome avec
outils, tout en conservant le contrat de diff par unité. L'orchestrateur générique
gère des définitions et des files de tâches mais n'exécute pas lui-même une boucle
LLM ; `executeOn('verifier', …)` est déjà un agent spécialisé complet et apporterait
moins de gain immédiat.

Principes retenus de la lecture comparative : canal d'entrée borné, événements
publics relayés et étiquetés, annulation descendante, fermeture/drainage propre.
L'implémentation TypeScript sera originale et adaptée aux contrats de Code Buddy.

## Cycles rouge → vert

### Brique 1 — moteur de délégation

Rouge avant source :

```text
$ HOME=$PWD/.deleg1-home TMPDIR=$PWD/.deleg1-tmp npx vitest run tests/agent/delegation/thread-delegation.test.ts
FAIL tests/agent/delegation/thread-delegation.test.ts
Error: Cannot find module '../../../src/agent/delegation/thread-delegation.js'
Test Files  1 failed (1)
Tests       no tests
EXIT_CODE=1
```

Rouge de la porte ESLint avant commit :

```text
src/agent/delegation/thread-delegation.ts:14:18
  error  An interface declaring no members is equivalent to its supertype
tests/agent/delegation/thread-delegation.test.ts:5:8
  warning  'ThreadDelegateAgent' is defined but never used
✖ 2 problems (1 error, 1 warning)
```

Vert de la brique 1 après correction :

```text
tests/agent/delegation/thread-delegation.test.ts : 1 fichier, 8 tests passés
ESLint ciblé --max-warnings=0 : code 0
npx tsc --noEmit -p . : code 0
```

## Preuve Ollama réelle

À compléter après vérification de `ollama ps`.

## Vérifications finales

À compléter.

## Points ouverts

À compléter.
