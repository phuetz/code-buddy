# 10. Référence des réglages

Ouvrez les réglages avec `Cmd/Ctrl+,` (ou l'icône engrenage). Les panneaux sont organisés en **sept
groupes**. Utilisez la recherche pour aller à un panneau par son nom. Les panneaux conseillés aux
débutants sont marqués « ★ Start here ».

## Essentials
- **Control center** — piloter Code Buddy : sécurité, automatisation, fleet et harness au même
  endroit.
- **General** — thème (Clair/Sombre/Open Cowork/Système), langue (en/fr/zh), préférences d'UI,
  stratégie de mémoire.
- **Audio & TTS** — micro, haut-parleur, voix de synthèse et débit de parole.
- **Code Buddy** — le backend agentique local (le moteur aux 100+ outils) et ses options.
- **Core engine** — choisir quelle boucle agentique tourne (Core engine vs runner embarqué).

## Models & Cost
- **API** — providers, clés API / connexions, base URLs, choix du modèle, test de connexion, et jeux
  de config enregistrés. ★
- **Cost** — usage de tokens, suivi des coûts, limites et alertes de budget.
- **Remote backend** — faire tourner chat/sessions sur un backend Code Buddy distant.

## Tools & MCP
- **Connectors** — configurer les intégrations (GitHub, Notion, navigateur…).
- **MCP marketplace** — parcourir et installer des serveurs MCP.
- **MCP playground** — tester des outils MCP avec des arguments JSON.
- **Customize** — plugins, connecteurs, workflows, hooks, et comportement de l'espace de travail.
- **Custom commands** — définir vos propres commandes slash.
- **Snippets** — modèles de prompt réutilisables.

## Skills & Plugins
- **Skills** — activer/désactiver les paquets `SKILL.md` (PPTX, DOCX, XLSX, PDF, et personnalisés).
- **Skills Browser** — parcourir les skills en langage naturel avec exemples.
- **Plugins** — installer et activer des composants plugin.

## Automation
- **Workflows** — l'éditeur DAG visuel et la bibliothèque de workflows enregistrés.
- **Schedule** — prompts planifiés en cron et agents cloud.
- **Hooks & triggers** — lancer des hooks shell/HTTP sur des événements de l'agent (avec dry-run).
- **Workspace presets** — enregistrer et appliquer des configurations de fenêtre/disposition.
- **Remote agents (A2A)** — enregistrer et invoquer des endpoints agent-to-agent distants.

## Security & Workspace
- **Sandbox** — isolation d'exécution WSL / Lima / native et installation des runtimes. ★
- **Permission rules** — règles allow/deny pour les outils et les chemins, avec testeur dry-run.
- **Projects** — Hubs d'espace de travail : instruction maître, fichiers de référence bornés et
  mémoire partagée entre les sessions du projet. Les décisions réutilisables peuvent devenir des
  [propositions d'évolution locales et approuvées](../../project-evolution.md), avec aperçu
  avant/après, détection d'obsolescence et rollback.
- **Config profiles** — profils de configuration isolés.

## Server & Diagnostics
- **Embedded server** — le serveur HTTP local : port, auth JWT, WebSocket.
- **Remote** — la gateway de contrôle distant Feishu/Lark/Slack (voir
  [Productivité & contrôle distant](09-productivity-and-remote.md#controle-distant)).
- **Network / Tunnel** — accès par tunnel public (ngrok).
- **Logs** — logs de l'application et sortie de debug.
- **Telemetry & diagnostics** — reporting de crash opt-in, traces, et stats d'usage.

> **Import/Export.** Sauvegardez ou déplacez tous vos réglages (clés, modèles, règles, snippets)
> depuis le panneau Import/Export — utile pour configurer une seconde machine.

> _[capture : vue d'ensemble des réglages avec les sept groupes]_
