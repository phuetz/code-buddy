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
- Brique `/team`, rouge collé avant code produit :
  `npx vitest run tests/commands/team-thread-delegation.test.ts`
  → 1 fichier, 4 tests en échec : le runtime/raccord `_resetTeamHandlerForTests` n'existait pas encore et `/team run` n'était pas implémenté.
- Brique `/team`, vert :
  `npx vitest run tests/agent/delegation tests/agent/team-manager.test.ts tests/agent/teams-and-definitions.test.ts tests/commands/team-thread-delegation.test.ts tests/commands/gk34-headless-slash.test.ts tests/commands/agents-handler.test.ts tests/commands/swarm-thread-delegation.test.ts`
  → 8 fichiers, 207 tests réussis. `npm run typecheck` → 0 erreur. ESLint ciblé sur 5 fichiers → 0 erreur.
- Preuve Ollama, tentative 1 non retenue : `ollama ps` montrait uniquement
  `qwen3:4b-instruct` (100 % GPU). Le dépôt jouet était propre et son test passait
  (1/1, 43,5 ms), mais `buddy -p "/swarm …"` a rendu un 404 en 1,05 s : le chemin
  `/agents` ne normalisait pas `OLLAMA_HOST=http://127.0.0.1:11434` vers `/v1`.
  Aucun fichier modifié ; le workflow a correctement déclaré `Success: no`.
- Rouge de non-régression Ollama, avant correction :
  `npx vitest run tests/commands/agents-handler.test.ts -t "enable with CODEBUDDY_PROVIDER=ollama"`
  → 1 échec : base attendue `http://127.0.0.1:11434/v1`, base reçue sans `/v1`.
- Vert Ollama : même commande → 1 test réussi (38 filtrés) ; la résolution passe
  désormais par le catalogue fournisseur, source de vérité qui ajoute `/v1`.
