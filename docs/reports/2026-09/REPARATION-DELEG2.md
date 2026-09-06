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
- Preuve Ollama, tentative 2 non retenue : flux réellement multiplexé (`coder` et
  `tester` démarrés avant leurs fins, durées 12 s et 18 s), workflow annoncé réussi
  en 55,3 s (mur 56,31 s), mais contrôle disque négatif : `square.js` absent. Le
  coder avait seulement émis un bloc `<artifact>` ; cette réussite déclarative ne
  prouve donc pas une modification réelle et est rejetée.
- Preuve Ollama finale réelle, code 0 : avant, dépôt jouet propre, `square.js`
  absent, 1/1 test en 42,2 ms ; `ollama ps` = seul `qwen3:4b-instruct`, 100 % GPU.
  Avec `CODEBUDDY_SWARM_CONCURRENCY=2`, `buddy -p "/swarm …"` a montré les tags
  `[swarm:coder:*]` et `[swarm:tester:*]`, les deux `turn_started` avant toute fin,
  un vrai appel `create_file` et un vrai appel `bash`. Coder 13 s, tester 11 s,
  workflow 45,1 s, mur 45,96 s. Après : `square.js` existe, `square(7)=49`, les
  trois fichiers initiaux sont inchangés et 1/1 test passe en 70,0 ms. Le modèle
  reste l'unique entrée d'`ollama ps`. Bilan honnête : la planification/synthèse
  porte le mur à ~46 s pour ce micro-cas ; le gain prouvé est l'isolation et le
  chevauchement des deux workers, pas la vitesse brute.
- Première suite imposée : 336 fichiers, 3 969 tests ; 333 fichiers/3 964 tests
  verts, 5 rouges environnementaux (2 remontées Git/CommonJS depuis le `TMPDIR`
  interne, 3 smokes privés du cache Playwright par le `HOME` temporaire). Aucun
  échec ne traverse les fichiers DELEG2. Rejeu prévu avec frontière Git sur le
  temporaire, marqueur CommonJS et cache navigateur existant en lecture seule.
- Après correction du harnais, les 3 fichiers environnementaux passent 67/67.
  Le passage complet suivant a eu un unique flake de charge `autonomous-code`
  (sortie JSON vide), vert seul puis vert dans le rejeu intégral.
- Vérification finale :
  `npx vitest run tests/agent tests/commands tests/orchestration`
  → 336 fichiers, 3 969 tests réussis, code 0.
  `npx tsc --noEmit -p .` → code 0.
  ESLint ciblé sur les 11 fichiers TypeScript touchés avec `--max-warnings=0`
  → code 0. Garde-fou données personnelles → 1/1. `git diff --check` → code 0.
- Commits : `97f6f049f` (réservation), `8cad8bccf` (`/swarm`), `de8e53563`
  (`/team`), `f4a982e9a` (normalisation Ollama locale).
