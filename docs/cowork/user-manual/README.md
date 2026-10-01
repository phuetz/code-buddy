# Cowork — Manuel utilisateur

**Cowork** est l'application desktop de [Code Buddy](https://github.com/phuetz/code-buddy) — une app
Electron qui met un agent de développement IA complet dans un espace de travail graphique et isolé.
Elle exécute votre agent sur un dossier que vous choisissez, vous montre tout ce qu'il fait, et
demande votre accord avant toute action risquée. Elle embarque **le même moteur** que le CLI Code
Buddy (ce n'est pas un fork) : providers, outils, MCP et skills en héritent.

> **À propos du nom.** Dans l'app, le produit s'affiche sous le nom **Code Buddy Studio** ;
> l'installateur est packagé sous *Code Buddy Cowork* ; le dossier projet et le nom courant sont
> *Cowork*. Ce manuel emploie **Cowork**.

## L'idée : une main et un cerveau

Cowork est la **main** — il lit des fichiers, écrit du code, lance des commandes, navigue, et vous
parle. Son compagnon, [Code Explorer](https://github.com/phuetz/code-explorer), est le **cerveau** —
un graphe de connaissances de votre codebase servi via MCP. Cowork s'utilise seul ; couplé à Code
Explorer, l'agent agit sur un projet qu'il comprend déjà.

## Concepts clés

| Terme | Signification |
|---|---|
| **Session** | Une conversation avec l'agent, affichée comme un onglet. Persistée et reprenable. |
| **Espace de travail** | Le dossier dans lequel l'agent a le droit d'agir. Choisi par session. |
| **Provider / modèle** | Le LLM derrière l'agent (Anthropic, OpenAI, Gemini, Ollama…). |
| **Sandbox** | L'environnement isolé où les commandes s'exécutent (WSL, Lima, ou natif + path guard). |
| **Mode de permission** | Ce que l'agent peut faire avant de demander (5 niveaux). |
| **Sous-agents / Fleet** | Agents auxiliaires en parallèle, en local ou sur plusieurs machines du réseau. |

## Sommaire

1. [Démarrage](01-getting-started.md) — installation, assistant de configuration, connexion d'un modèle, première tâche
2. [L'interface](02-interface.md) — fenêtres, onglets, chat, panneaux, thèmes, langues
3. [Travailler avec l'agent](03-working-with-the-agent.md) — messages, outils, approbations, modèles
4. [Permissions & sandbox](04-permissions-and-sandbox.md) — les 5 modes, les règles, l'isolation
5. [Fichiers, Git & checkpoints](05-files-git-checkpoints.md) — aperçus, diffs, commits, annuler/restaurer
6. [Sessions & historique](06-sessions-and-history.md) — onglets, projets, reprise, recherche, insights, export
7. [Multi-agent & fleet](07-multi-agent-and-fleet.md) — sous-agents, teams, fleet, le tableau Kanban
8. [Outils, MCP & skills](08-tools-mcp-skills.md) — connecteurs, marketplace, skills, workflows
9. [Productivité & contrôle distant](09-productivity-and-remote.md) — mémoire, voix, companion, remote control
10. [Référence des réglages](10-settings-reference.md) — tous les onglets de réglages
11. [Raccourcis clavier](11-keyboard-shortcuts.md) — la liste complète
12. [Dépannage](12-troubleshooting.md) — problèmes courants et solutions

## Prérequis (en bref)

- **Distribution disponible** : la release v2.2.0 contient le paquet npm du CLI ; elle ne
  publie aucun installateur Cowork `.exe`, `.app` ou `AppImage`.
- **Depuis les sources** : Node.js **≥ 22**, un checkout Code Buddy, puis `npm install` et
  `npm run build` à la racine. Dans ce checkout, exécutez `node dist/index.js install-gui`
  puis `node dist/index.js gui`. Le paquet npm CLI seul ne contient pas Cowork.
  Voir [Démarrage](01-getting-started.md) pour les commandes et les détails Linux.
- Un **provider IA** — une clé API, une connexion ChatGPT, ou un modèle local (Ollama / LM Studio).

## Notes & limites

- Ce manuel décrit le build `feat/fleet-unified-kanban`. La disponibilité des fonctions varie selon
  la version ; certains panneaux (companion vision, fleet) sont optionnels et masqués tant qu'ils ne
  sont pas activés.
- Les captures sont notées `> _[capture : …]_` — à ajouter en photographiant l'app lancée.
- Consultez les assets d'une release avant de choisir un téléchargement : ce manuel ne
  suppose pas qu'un installateur Cowork y soit disponible.
