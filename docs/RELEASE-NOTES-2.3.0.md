# Code Buddy 2.3.0 — notes de version / release notes

Candidat préparé le 1er octobre 2026, sortie prévue le 8 octobre sous réserve de validation du premier usage.

## Français

La RC réunit les correctifs de premier usage CLI et Cowork, le catalogue configurable des modèles, les lots de sécurité et de fiabilité relus, les règles facultatives du journal Lisa et le skill RagChat. LM Resizer reste disponible avec conservation du contenu brut et repli sur erreur. Le [CHANGELOG](../CHANGELOG.md#230-2026-10-01) décrit exactement les branches intégrées.

Le catalogue expose 338 entrées. Les traces historiques P8/P9 ne constituent pas une validation générale du candidat : la vitrine conserve une qualification explicite et vérifie la fraîcheur des sources.

### Installation et vérification

Après publication :

```sh
npm install -g @phuetz/code-buddy@2.3.0
buddy --version
buddy doctor --offline
buddy catalog status --json
```

Le CLI requiert Node 20 ou plus récent. Cowork depuis les sources requiert Node 22, ses dépendances et un bundle construit complet ; voir le [guide Cowork](cowork.md). Ollama nécessite un modèle déjà installé et adapté aux appels d'outils. Les outils réseau peuvent contacter leurs services même lorsque l'inférence est locale.

### Limites connues

- La recette Linux du candidat ne certifie pas Windows, macOS ni les services externes.
- Les correctifs de la lane sortie-sûre ne sont pas inclus dans cette phase A ; la sortie reste conditionnée à la validation du parcours d'un inconnu.
- Le filtre statique du shell ne protège pas tous les chemins construits à l'exécution. Un secret suivi par Git peut encore être lu via les objets Git ; cette garantie est reportée à la 2.3.1.
- Un statut inconnu ou une trace ancienne ne prouve pas le bon fonctionnement d'une fonctionnalité.

## English

This release candidate combines reviewed CLI and Cowork onboarding fixes, configurable model catalogues, security and reliability patches, optional Lisa journal rules and the RagChat skill. LM Resizer retains raw tool output and falls back on errors. See the [changelog](../CHANGELOG.md#230-2026-10-01) for the integrated changes.

The catalogue contains 338 entries. Historical P8/P9 traces do not qualify the whole candidate; explicit review and source freshness determine the showcase status.

After publication, install with `npm install -g @phuetz/code-buddy@2.3.0`, then run `buddy --version`, `buddy doctor --offline` and `buddy catalog status --json`. The CLI requires Node 20 or newer. Building Cowork from source requires Node 22, its own dependencies and a complete application bundle. Local inference requires a suitable model already installed in Ollama; network tools may still contact external services.

Linux checks do not validate Windows, macOS or external services. Phase A excludes the pending safe-release fixes. Static shell filtering cannot cover every computed path; secrets committed to Git can still be read from Git objects. That guarantee remains deferred to 2.3.1. Unknown catalogue status or historical evidence does not prove current functionality.
