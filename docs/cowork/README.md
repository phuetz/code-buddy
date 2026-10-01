# Documentation Cowork

Cowork est l'application desktop (Electron) de Code Buddy. Elle embarque **le même
moteur** que le CLI — pas un fork — donc tous les providers, outils, MCP, skills et
middlewares en héritent. Cette documentation couvre l'architecture, les panneaux,
les workflows visuels, le build, les réglages et le dépannage.

> **Statut dans la vitrine : non prouvée ici.** Les [entrées Cowork du catalogue](../FONCTIONNALITES-PROUVEES.md#domain-cowork) ne disposent pas de trace exécutée. Les termes « solide » et « expérimental » des pages techniques décrivent des appréciations d'architecture historiques ; ils ne sont pas des statuts de preuve du candidat.

> 📘 **Vous cherchez le mode d'emploi ?** Cette doc est orientée **dev/architecture**. Pour un
> **manuel utilisateur** pas-à-pas (installation, interface, permissions, multi-agent, réglages,
> raccourcis, dépannage), voir **[`user-manual/`](user-manual/README.md)**.

## Sommaire

| Page | Contenu |
|------|---------|
| [00 — Vue d'ensemble](00-overview.md) | Ce qu'est Cowork, le moteur embarqué, la stack, le lancement |
| [01 — Architecture](01-architecture.md) | main / preload / renderer, le pont IPC, l'état persistant |
| [02 — Les panneaux](02-panels.md) | Tous les onglets du dock, par groupe, avec leur statut |
| [— Panneaux de réglages](settings-panels.md) | Détail des onglets de la fenêtre Settings |
| [03 — Workflows visuels](03-workflows.md) | Le DAG visuel → l'Orchestrator core (pool de 4 agents) |
| [04 — Build, dev, run](04-build-run.md) | `build:gui`, la boucle de dev Linux, `rebuild`, les tests |
| [05 — Réglages & serveur](05-settings-server.md) | Providers/modèles, OAuth, le serveur HTTP embarqué |
| [06 — Dépannage](06-troubleshooting.md) | Les gotchas (dual-mainWindow, ABI sqlite, GPU Linux…) |

## Démarrage rapide

```bash
npm install && npm run build  # depuis un checkout source, Node ≥ 22
node dist/index.js install-gui
node dist/index.js gui                  # lance l'application (alias : buddy desktop)
# Dev :
cd cowork && npm run dev
```

Voir aussi : [`cowork/ARCHITECTURE.md`](../../cowork/ARCHITECTURE.md) · [`docs/cowork.md`](../cowork.md) · [`cowork/DEV-LINUX.md`](../../cowork/DEV-LINUX.md).
