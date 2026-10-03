# Troisième reprise — import des hooks — 03/10/2026

Départ `e15d4b7ec`, même branche `feat/import-hooks-2026-10-03`. Mission et revue indépendante lues intégralement ; réservation `b55b38d9b` avant correction. Le bloquant documentaire est accepté : les vérifications précédentes précédaient le dernier ajout documentaire. L’annonce finale ne validait donc pas le commit livré. Le rapport précédent est rectifié sans affaiblir le garde d’hygiène.

Rectification de la quatrième reprise : les tests ci-dessous établissaient le refus d’un `cat` dont le chemin devient visible après assemblage. Ils ne prouvaient pas la sûreté d’une commande arbitraire : la revue a fait lire un secret factice du projet par Python/chr. Le classificateur textuel partagé reste limité. La [quatrième reprise](REPRISE-4-IMPORT-HOOKS-2026-10-03.md) refuse les remplacements non prouvés par une grammaire littérale fermée, avant toute réécriture.

| Bloquant / réserve | Traitement | Preuve |
|---|---|---|
| Chemin personnel dans le rapport public | Chemin retiré, livraison conservée dans le dossier d’échange hors dépôt public | Baseline 39 verts / 1 rouge ; document précédent réintroduit par mutation : 1 rouge ; correction : 40 verts |
| `updatedInput.command` assemblé vise une clé SSH | Contrôle avant réécriture par le classificateur Bash existant ; contrôle aussi de `initial_command`, champ réel de l’outil interactif | Quatre cas Bash / alias / interactif ; mutation neutralisant le contrôle : 4 rouges. Commande admissible conservée, erreur de classification bloquante |
| Annonce verte sur commit documentaire non vérifié | Portée de l’ancien résultat corrigée ; barrière exécutée après le commit documentaire définitif | Sorties brutes, révision testée et résultat final dans le rapport remis hors dépôt public |

Correctif `3762c4c92`. Six tests ajoutés, 47 tests dans le fichier de contre-revues. Avant commit : 87 tests ciblés verts, typecheck complet code 0, lint complet code 0 (0 erreur / 2 601 avertissements). Deux mutations tuées, cinq assertions rouges, sources restaurées. Aucun changement du scanner partagé ni du garde de données personnelles.

Recette réelle avec HOME isolé et Ollama local qwen3.5:4b : Bash renvoie `bonjour` désactivé, `salut` après activation. Avec la commande SSH reconstruite, la requête réelle au modèle contient le refus du garde ; aucune sortie d’exécution ni octet de la clé factice. Capture de `fetch` en passage transparent, sans changement des requêtes. Les premières tentatives sans appel d’outil et les réponses hallucinant une exécution sont conservées et ne valent pas preuve. Hooks de recette désactivés après mesure.

ECC épinglé au clone existant : vrai CLI, 24 handlers, 0 admissible / 9 quarantaines / 15 refus. Snapshots HOME / workspace / ECC inchangés en mode rapport. Aucun handler ECC activé.

Commande de barrière sur le commit documentaire définitif :

```sh
VITEST_MAX_WORKERS=1 npm test -- tests/hooks tests/skills tests/security/skill-scanner tests/security/skill-firewall tests/agent/execution/fleet-tool-hooks.test.ts tests/agent/execution/agent-executor.test.ts tests/agent/agent-executor-lanes.test.ts tests/security/donnees-personnelles.test.ts
```

Le rapport détaillé et les preuves, avec le résultat de cette commande et l’état Git final, sont remis dans le dossier d’échange convenu. Aucun push, aucune tâche autonome de fond.

## Ce que je n'ai pas pu vérifier

Windows/macOS, CI distante, packaging et suite complète non exécutés. Aucun terminal interactif réel ouvert : `initial_command` vérifié par le callback de production dans les tests. ECC reste intégralement en quarantaine ou refusé ; aucun hook ECC activé. La supervision Linux / Python3 et ses limites restent celles de la seconde reprise. La restitution fidèle d’un refus par le modèle varie ; les preuves portent sur la décision du garde et les sorties d’outil effectives.
