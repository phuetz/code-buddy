# Réparation PROMPTBUDGET1 — prompt système maigre et troncature par priorité

Date : 2026-09-04  
Dépôt : `~/DEV/cb-promptbudget1-2026-09-04`  
Branche : `feat/promptbudget1-prompt-maigre-2026-09-04`

## État

Rapport créé avant toute inspection du dépôt, puis complété au fil des trois
points. Aucun accès à un fournisseur, aucun push et aucun service redémarré.

## 1. Mesure hermétique avant réduction

Commande :

```bash
HOME="$PWD/_qa/promptbudget1/home" npx tsx scripts/measure-system-prompt.ts
```

Le script instancie `PromptBuilder` directement, avec un `PromptCacheManager`
inactif, un magasin mémoire vide sous `_qa/promptbudget1/home`, sans client
LLM ni `fetch`. La variation est désactivée uniquement pour que la somme des
sections soit déterministe et exactement égale au prompt pré-tronquage. Les
jetons sont estimés comme dans le code existant : `ceil(caractères / 4)`.

### Tableau réel, avant réduction

Les valeurs sont en caractères ; entre parenthèses : jetons estimés. Les
pourcentages sont calculés sur le prompt pré-tronquage du modèle.

| Bloc | Source réelle | gpt-5.6-luna | mistral-medium-latest | qwen3.8:27b |
|---|---|---:|---:|---:|
| base | `src/prompts/system-base.ts` | 8 175 (2 044), 4,01 % | 8 175 (2 044), 4,01 % | 8 175 (2 044), 4,01 % |
| execution-discipline | `src/prompts/execution-discipline.ts` | 843 (211), 0,41 % | 843 (211), 0,41 % | 843 (211), 0,41 % |
| workspace-context | `AGENTS.md`, `CLAUDE.md` | 32 890 (8 223), 16,15 % | 32 890 (8 223), 16,15 % | 32 890 (8 223), 16,15 % |
| persona | `src/personas/persona-manager.ts` (persona builtin) | 312 (78), 0,15 % | 312 (78), 0,15 % | 312 (78), 0,15 % |
| knowledge | `.codebuddy/knowledge` + `src/knowledge/knowledge-manager.ts` | 11 679 (2 920), 5,73 % | 11 679 (2 920), 5,73 % | 11 679 (2 920), 5,73 % |
| project-docs | `.codebuddy/docs` + `src/docs/docs-context-provider.ts` | 2 033 (509), 1,00 % | 2 033 (509), 1,00 % | 2 033 (509), 1,00 % |
| identity | `.codebuddy/TOOLS.md` via IdentityManager | 134 751 (33 688), 66,16 % | 134 751 (33 688), 66,16 % | 134 751 (33 688), 66,16 % |
| auto-memory-directive | outils mémoire | 1 597 (400), 0,78 % | 1 597 (400), 0,78 % | 1 597 (400), 0,78 % |
| lessons-directive | outils mémoire | 2 835 (709), 1,39 % | 2 835 (709), 1,39 % | 2 835 (709), 1,39 % |
| self-knowledge | `src/agent/self-improvement/self-knowledge.ts` | 927 (232), 0,46 % | 927 (232), 0,46 % | 927 (232), 0,46 % |
| user-model-directive | outil mémoire | 1 453 (364), 0,71 % | 1 453 (364), 0,71 % | 1 453 (364), 0,71 % |
| writing-rules | directive de style | 1 954 (489), 0,96 % | 1 954 (489), 0,96 % | 1 954 (489), 0,96 % |
| coding-style | `src/memory/coding-style-analyzer.ts` | 358 (90), 0,18 % | 358 (90), 0,18 % | 358 (90), 0,18 % |
| workflow-rules | `src/prompts/workflow-rules.ts` | 3 867 (967), 1,90 % | 3 867 (967), 1,90 % | 3 867 (967), 1,90 % |
| **Total pré-tronquage** |  | **203 674 (50 919)** | **203 674 (50 919)** | **203 674 (50 919)** |

La mesure de cette branche est de 203 674 caractères (et non 212 366 dans le
constat du 04/09) : l’écart est dû à l’état exact du clone, à la sélection de
modèle et au magasin QA vide ; il ne change pas le diagnostic. Le budget
actuel calculé pour les trois modèles est 128 000 caractères (32 000 jetons,
plafond dur), d’où une coupe de 75 674 caractères, actuellement sans notion
de bloc.

### Doublons, blocs morts et contenu de tour

- Aucun doublon textuel exact entre les blocs mesurés : les SHA-256 des 15
  contributions sont distincts. Il existe cependant un doublon fonctionnel
  majeur : `.codebuddy/TOOLS.md` répète la description des outils déjà fournie
  au modèle dans le schéma `tools` ; `BootstrapLoader` l’excluait déjà avec
  cette justification, mais `IdentityManager` le rechargeait.
- Le bloc `bootstrap` est absent de ce clone QA : aucun `SOUL.md`, `USER.md`,
  `BOOT*.md` ou `PROJECT_KNOWLEDGE.md` n’a été chargé par `BootstrapLoader`.
  Ce chemin conditionnel n’est donc pas un coût permanent.
- Le JIT (`resolveJitContext`) n’est jamais appelé par `buildSystemPrompt` :
  son contenu appartient au contexte de tour après accès à un fichier, pas au
  prompt système initial. Il ne doit pas être préchargé ici.
- `project-docs`, `knowledge`, la mémoire collective et le nudge fleet sont
  des contextes conditionnels. Ils doivent rester récupérables à la demande
  par leurs outils/chargeurs ; seuls leurs résumés bornés ont vocation à être
  dans le prompt système.
- Les directives `lessons`, `auto_memory` et `user_model` décrivent des
  décisions prises pendant un tour. Elles restent des règles système courtes,
  mais leur contenu opérationnel détaillé est candidat à une expansion à la
  demande, pas à une copie de documentation complète.

## 2. Réductions appliquées

Les réductions sûres suivantes sont appliquées :

1. `IdentityManager` ne charge plus `TOOLS.md` par défaut. Les descriptions
   fonctionnelles sont déjà livrées par le schéma d’outils ; le fichier de
   134 751 caractères était donc une duplication fonctionnelle. Le chargement
   explicite via `fileNames` reste possible pour les intégrations qui le
   demandent.
2. Le bloc de connaissance de démarrage est un index borné à 1 600 caractères
   (`<knowledge_index>`), avec titres et tags. Le détail reste accessible par
   `knowledge_search`; si cet outil est filtré, le code conserve le bloc
   complet par précaution.
3. Le contexte projet de démarrage charge seulement `AGENTS.md` et
   `CODEBUDDY.md`, les deux sources canoniques du dépôt. Les fichiers
   d’interopérabilité peuvent être réactivés explicitement avec
   `CODEBUDDY_INCLUDE_INTEROP_CONTEXT=true` et le JIT reste disponible après
   accès à un fichier.
4. Le bloc de base n’a pas été résumé : il conserve les règles de secrets,
   de confirmation et de sandbox. Le test ciblé vérifie leur présence.

### Tableau réel, après réduction (avant troncature)

| Modèle | Caractères | Jetons estimés | Budget caractères | Prompt livré | Jetons livrés |
|---|---:|---:|---:|---:|---:|
| gpt-5.6-luna | 49 489 | 12 373 | 128 000 | 49 489 | 12 373 |
| mistral-medium-latest | 49 489 | 12 373 | 128 000 | 49 489 | 12 373 |
| qwen3.8:27b | 49 489 | 12 373 | 128 000 | 49 489 | 12 373 |

Le prompt par défaut passe donc de 203 674 à 49 489 caractères (-75,7 %),
sous la cible de 60 000 caractères pour un modèle 128 k. Le gain principal
vient de `TOOLS.md` (-134 751 caractères), puis du contexte projet canonique
(24 631 caractères au lieu de 32 890) et de l’index de connaissance (504 au
lieu de 11 679). Les trois modèles donnent le même assemblage hors ligne ;
leurs fenêtres ne divergent qu’au calcul du budget.

## 3. Troncature par priorité

À compléter avec la priorité déclarée (sécurité > outils > style > exemples),
la suppression de blocs entiers et le journal `WARN … blocs retirés : …`.

## Vérifications

Point 1 : `npx tsc --noEmit -p .` = 0 ; `HOME=... npx vitest run tests/services/prompt-builder.test.ts` = 1 fichier, 42 tests verts. Le script de mesure produit le tableau ci-dessus sans réseau.
Point 2 : `HOME=... npx vitest run tests/services/prompt-builder.test.ts tests/identity/identity-manager.test.ts` = 2 fichiers, 84 tests verts ; `npx tsc --noEmit -p .` = 0.

## Bilan

À compléter (dix lignes maximum, avec les SHA des commits fonctionnels).
