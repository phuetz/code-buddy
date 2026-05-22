# État du Code — Cartographie Réelle (Mai 2026)

Ce document dresse l'inventaire complet de la base de code `grok-cli-weekend` (alias Code Buddy) afin d'aligner le plan de modernisation sur le code réel.

---

## 1. Surfaces & Entrées (Les 3 Cockpits)

Code Buddy possède trois interfaces d'entrée qui partagent toutes le même moteur sous-jacent (`CodeBuddyAgent` / `AgentExecutor`).

### A. Interface CLI (Terminal)
- **Point d'entrée** : `src/index.ts` (Commander CLI)
- **Fichiers clés** : 
  - `src/index.ts` : configure le démarrage, charge l'environnement, gère les exceptions globales et définit les commandes de haut niveau avec chargement paresseux (*lazy loading*).
  - `src/agent/codebuddy-agent.ts` : boucle agentique principale (`executePlan()`).
  - `src/agent/execution/agent-executor.ts` : exécuteur de tours de parole (`runTurnLoop`).
- **Commandes CLI principales** :
  - `buddy` : démarre une session interactive.
  - `buddy provider` : gère les fournisseurs d'IA (Claude, ChatGPT, Grok, Gemini, etc.).
  - `buddy mcp` : configure les serveurs Model Context Protocol.
  - `buddy server` : démarre le serveur d'API HTTP/WebSocket.
  - `buddy gui` / `buddy desktop` : lance l'interface Electron Cowork.
  - `buddy dev <subcommand>` : workflows développeurs (plan, run, pr, fix-ci, explain).
  - `buddy run <subcommand>` : inspecte et rejoue des runs passés.
  - `buddy research "<topic>"` : lance des agents de recherche en parallèle.
  - `buddy flow "<goal>"` : lance le planificateur multi-agents compatible OpenManus.
  - `buddy todo` : gère la liste de tâches persistante injectée dans le contexte.
  - `buddy lessons` : gère la mémoire d'amélioration continue (leçons apprises).
  - `buddy autonomous-code` : exécute une tâche autonome bornée (cellule de codage).
  - `buddy secrets` : coffre-fort chiffré pour les clés d'API.
  - `buddy approvals` : gère les demandes d'approbation d'actions.
  - `buddy deploy` : génère des configurations de déploiement cloud.
  - `buddy backup` / `buddy cloud` / `buddy completions`.

### B. Cockpit Graphique (Cowork)
- **Point d'entrée** : `cowork/src/main/index.ts` (Electron Main)
- **Fichiers clés** :
  - `cowork/` : projet Electron séparé avec Vite + React + TypeScript.
  - `cowork/src/main/window-management.ts` : gère le cycle de vie de la fenêtre principale.
  - `cowork/src/main/ipc-main-bridge.ts` : gère la communication IPC bidirectionnelle entre Electron et l'application React.
  - `cowork/src/main/workflows/workflow-bridge.ts` : enveloppe l'orchestrateur de Code Buddy pour exécuter des flux de travail visuels.
- **Espace de stockage** : base SQLite via `better-sqlite3` avec gestion de schéma dédiée.

### C. Collaboration Multi-Instances (Fleet Mesh)
- **Point d'entrée** : `src/fleet/` + `src/server/websocket/`
- **Fichiers clés** :
  - `src/fleet/peer-chat-bridge.ts` : implémentation de `peer.chat` (appel LLM simple vers un pair).
  - `src/fleet/peer-session-store.ts` : implémentation de `peer.chat-session.*` (conversations multi-tours persistantes).
  - `src/fleet/peer-tool-bridge.ts` : implémentation de `peer.tool.invoke` (exécution d'outils distants en lecture seule).
  - `src/fleet/task-router.ts` : routeur sémantique (`route_peer` tool / `/fleet route`) pour assigner des tâches selon les capacités et contraintes des pairs.
- **Protocoles de communication** : WebSockets (passerelle port 3001) et RPC HTTP (serveur port 3000).

---

## 2. Modules Présents dans le Moteur (`src/`)

L'application est structurée en micro-modules spécialisés sous le dossier `src/` :
- `agent/` : cœur de la boucle agentique.
  - `autonomous/` : cellule de codage autonome (runner, contrat de run).
  - `facades/` : gestionnaires de session, de contexte, de modèles, d'infrastructure.
  - `execution/` : moteur de génération de tours (`runTurnLoop`).
  - `thinking/` & `reasoning/` : outils de réflexion profonde et ToT (Tree of Thoughts) + MCTS.
- `commands/` : commandes et sous-commandes de la CLI.
- `context/` : gestion intelligente de la fenêtre de contexte (`ContextManagerV2`) et compactage.
- `database/` : abstractions pour SQLite et migrations DB.
- `fleet/` : routage et communication multi-agents.
- `memory/` : gestion de la mémoire à long terme (SQLite + embeddings sémantiques, graphe de connaissances, consolidation).
- `security/` : Guardian Agent, linter PII, coffre chiffré, modes de permission et vérification de signatures.
- `server/` : serveur HTTP d'API et passerelle WebSocket.
- `tools/` : implémentations des ~110 outils de codage, de navigation et d'exécution, avec routage RAG sémantique (`tools.ts`).
- `utils/` : logger unifié, gestion d'arrêt propre (graceful shutdown), support proxy, etc.

---

## 3. Écarts Constatés avec le Plan de Modernisation

Après inspection de la base de code réelle, voici les ajustements par rapport aux hypothèses initiales du plan de modernisation :

1. **Intitulés des tests skippés** :
   Le plan supposait 9 tests skippés dans `agent-core.test.ts`. L'analyse réelle montre 8 tests skippés dans `tests/unit/agent-core.test.ts`. Ces tests sont liés à l'ancienne boucle séquentielle V0.4 qui a été remplacée par `runTurnLoop` (générateur asynchrone).
2. **Parser de scripts hérité (Legacy)** :
   Le test `tests/unit/scripting-parser.test.ts` est marqué globalement en `describe.skip`. Il a été remplacé fonctionnellement par `tests/unit/fcs-parser.test.ts` (173 assertions fonctionnelles). Le fichier hérité doit être supprimé pour réduire l'entropie.
3. **Périmètre du Policy Engine (WS5)** :
   Le plan prévoit un Policy Engine centralisé. Dans le code existant, les permissions et la sécurité sont gérées par `ConfirmationService` et `AutonomyManager`, ainsi que par des middlewares spécifiques. La modernisation WS5 devra consolider et unifier ces systèmes existants plutôt que d'ajouter une couche redondante.

---

## 4. Résultats de la validation (IMM-T1 - 2026-05-22)

La commande `npm run validate` a été exécutée avec succès sur l'environnement Windows cible :
- **Linter (ESLint)** : Vert (0 erreur, 2235 avertissements de style/unused-vars).
- **Typecheck (TSC)** : Vert (0 erreur).
- **Tests unitaires et d'intégration (Vitest)** :
  - **Fichiers de test** : 908 passés, 2 ignorés (910 au total).
  - **Nombre total de cas de test** : 28505 passés, 86 ignorés (28591 au total).
  - **Durée totale** : 53.02 secondes.
  - **Statut final** : Vert complet (aucune erreur).



