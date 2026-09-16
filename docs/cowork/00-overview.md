# Cowork — Vue d'ensemble

Cowork est l'application desktop de Code Buddy. Ce n'est **pas un fork** du CLI : c'est une enveloppe Electron qui **embarque le même moteur Code Buddy** que le terminal. Le cockpit graphique (chat, traces, workflows, Fleet, Companion…) se branche dessus ; tout le raisonnement, l'exécution d'outils et le routage de modèles restent fournis par le cœur partagé.

## Le point clé : un seul moteur, deux interfaces

Le moteur de l'agent vit dans `code-buddy/src/` (la racine du monorepo). Cowork ne le réimplémente pas : il le charge via un adaptateur dédié, `src/desktop/codebuddy-engine-adapter.ts` (compilé en `dist/desktop/codebuddy-engine-adapter.js`), qui enveloppe directement la classe `CodeBuddyAgent`. Côté Cowork, `cowork/src/main/engine/codebuddy-engine-runner.ts` consomme cet adaptateur et traduit le flux d'événements du moteur en événements d'interface.

Conséquence directe : **Cowork hérite gratuitement de tout ce que le CLI sait faire.**

| Capacité du cœur | Source | Partagée avec Cowork |
| --- | --- | --- |
| Providers LLM (Grok, Claude, GPT, Gemini, Ollama local, LM Studio, Bedrock, Azure, Groq, Together, Fireworks, OpenRouter, vLLM, Copilot, Mistral) | `src/codebuddy/providers/` | Oui |
| Outils (~110) + sélection RAG | `src/codebuddy/tools.ts` | Oui |
| Serveurs MCP | `MCPManager` (cœur) | Oui (poussés via l'adaptateur) |
| Skills (SKILL.md) | registre du cœur | Oui (rechargés via l'adaptateur) |
| Middlewares (limite de tours, coût, raisonnement, auto-repair, quality gate…) | `src/agent/middleware/` | Oui |
| Réparation de transcript + sanitizer de sortie | `src/context/`, `src/utils/` | Oui |

La synchronisation d'état Cowork → moteur passe par des méthodes optionnelles de l'interface `EngineAdapter` (`src/desktop/engine-adapter.ts`) : `setMcpServers()` pousse l'ajout/retrait de serveurs MCP, `setPermissionCallback()` branche la modale de permission de la GUI sur le `ConfirmationService` du cœur, et `reloadSkills()` recharge le registre SKILL.md après installation/désinstallation.

> **Honnêteté sur le fallback** : par défaut Cowork tourne sur le moteur embarqué (« engine path »). Il subsiste un chemin de repli, le runner historique `pi-coding-agent` (`ClaudeAgentRunner`), utilisé uniquement quand le bundle du moteur est absent (par exemple `cowork/` checkout sans build du CLI parent) ou quand `CODEBUDDY_EMBEDDED=0` est forcé. Ce repli n'a pas la parité complète — voir `cowork/RUNNER_AUDIT.md` pour la matrice détaillée. Le badge dans la barre de titre indique en permanence quel runner est actif.

## Stack technique

| Élément | Choix |
| --- | --- |
| Shell applicatif | Electron (processus **main** / **preload** / **renderer**) |
| Build & bundling | Vite |
| Interface | React (renderer `cowork/src/renderer/`) |
| Stockage local | better-sqlite3 (module natif, recompilé contre les en-têtes Electron) |
| Node requis | **≥ 22** pour Cowork (le CLI racine reste compatible **≥ 18**) |

`better-sqlite3` étant natif, il est reconstruit pour Electron via `npm run rebuild` (déclenché au `postinstall`). C'est attendu, pas un bug : si Electron refuse de démarrer après un changement de version de Node, relancer la reconstruction.

## Installation et lancement

Cowork **ne se télécharge pas séparément** : il vit dans le monorepo Code Buddy. On installe Code Buddy, puis on construit et lance la GUI.

```bash
# 1. Récupérer Code Buddy (Cowork exige Node.js >= 22 ; le CLI racine >= 18)
git clone https://github.com/phuetz/code-buddy.git
cd code-buddy && npm install && npm run build && npm link   # expose la commande `buddy`

# 2. Construire puis lancer l'application desktop
buddy install-gui        # installe Electron + construit le bundle Cowork
buddy gui                # lance la GUI (alias : buddy desktop)
```

Les commandes `gui`, `desktop` et `install-gui` sont enregistrées dans `src/index.ts` (le CLI Commander). `buddy desktop` est un alias strict de `buddy gui`.

### Boucle de développement

Depuis le dossier `cowork/`, en rechargement à chaud :

```bash
cd cowork && npm run dev          # Vite + Electron depuis les sources
```

> **Note Linux** (cible de dev principale) : le `npm run dev` complet est lourd et parfois fragile (téléchargement de Node, préparation du runtime Python embarqué). Pour itérer vite, construire seulement le renderer avec `npx vite build` (~30 s) et booter Electron avec `--no-sandbox --disable-gpu`. Détails dans `cowork/DEV-LINUX.md`.

## Pour aller plus loin

- `cowork/ARCHITECTURE.md` — les trois contextes Electron, les bridges (Workflow, Hooks, A2A, Presence, Server, SubAgent, Team, Fleet), les canaux IPC, l'état persistant, et le modèle de runner.
- `cowork/README.md` — README source de Cowork : fonctionnalités, démos, install, skills embarqués.
- `docs/cowork.md` — vue d'ensemble intégrée côté monorepo + la politique de confidentialité des captures d'écran/vidéos de QA.
