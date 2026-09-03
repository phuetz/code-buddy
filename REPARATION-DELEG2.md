# Réparation DELEG2 — `/swarm` et `/team`

Rapport de chantier créé le 2026-09-03 avant toute inspection du dépôt.

## Objectif

Faire passer `/swarm`, puis `/team`, par `thread-delegation` avec les garanties DELEG1, sans modifier QualityGate ni Verifier.

## Journal des preuves

- Brique `/swarm`, rouge collé avant code produit :
  `npx vitest run tests/agent/delegation/thread-task-runner.test.ts tests/commands/swarm-thread-delegation.test.ts`
  → 2 fichiers en échec : module `thread-task-runner.js` absent, puis 2 assertions rouges car `/swarm` ne transmettait aucune configuration `threadDelegation`.
- Brique `/swarm`, vert :
  `npx vitest run tests/agent/delegation/thread-task-runner.test.ts tests/commands/swarm-thread-delegation.test.ts tests/agent/delegation/thread-delegation.test.ts tests/commands/agents-handler.test.ts`
  → 4 fichiers, 54 tests réussis. `npm run typecheck` → 0 erreur. ESLint ciblé sur 7 fichiers → 0 erreur.
