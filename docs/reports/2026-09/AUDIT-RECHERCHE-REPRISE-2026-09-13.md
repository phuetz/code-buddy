# Audit complémentaire : recherche et reprise

Audit local de la branche `codex/audit-ameliorations-2026-09-13`, base `212b7fe53`. Trois nouveaux défauts reproduits, plus une lacune de recherche déjà signalée et reconfirmée. Aucun correctif de production dans cette tranche.

## 1. P1 — Installation réussie, archivage échoué, reprise perdue

`src/agent/self-improvement/skill-engine.ts:143–168` installe avant d'ajouter la preuve à l'archive. L'écriture peut échouer ; le cycle rejette alors sa promesse alors que la skill est déjà présente et chargée. Le scénario est déjà dans `attempted` et `covered` : le cycle suivant ne réessaie pas l'archivage.

**Preuve :** sonde avec le vrai `LiveSkillMutator`, le vrai registre et la vraie archive, dont la destination est occupée par un répertoire temporaire. Résultat : `rejected=true`, `installed=true`, `loaded=true`, `archived=0`, `retryScenario=null`. Le résultat comportemental est injecté pour isoler la panne de stockage, sans appel LLM. Ce test ne simule pas une coupure électrique.

**Amélioration :** journaliser l'intention d'application avant l'installation, enregistrer les étapes et réconcilier au démarrage. En cas d'échec, rendre explicite l'état « installé, preuve à persister » ; ne pas marquer le scénario terminé avant l'accusé d'écriture. Prévoir une réparation idempotente afin de ne pas régénérer ou réinstaller une skill déjà appliquée.

## 2. P1 — Le délai DGM ne termine pas les descendants

`src/agent/self-improvement/evolution/variant-fitness.ts:73–120`, `runProc`, envoie SIGTERM puis SIGKILL au processus immédiat uniquement. Un descendant conserve stdout/stderr, ce qui retarde l'événement `close` et donc la résolution du score.

**Preuve Linux :** timeout demandé de 100 ms ; un enfant lance un descendant fini de 1,5 seconde, avec les pipes hérités. `runProc` retourne après environ 1 543 ms, avec `timedOut=true` ; le descendant a eu le temps d'écrire son marqueur. Tous les fichiers sont temporaires et le descendant s'arrête lui-même. Une attente sans fin est une conséquence possible du mécanisme, pas un processus infini lancé par la sonde.

**Amélioration :** réutiliser la gestion des groupes de processus et l'escalade déjà développées pour l'exécution shell ; gérer aussi le nettoyage des timers et la fermeture bornée des pipes. Tester les processus imbriqués et prévoir l'équivalent Windows.

## 3. P2 — Collision entre propositions de scénarios différents

`src/agent/self-improvement/proposal-store.ts:56–107` transforme toute ponctuation en tirets. `audit/a` et `audit:a` partagent donc `skill-audit-a.json`. Le chargement vérifie le type de proposition mais ne vérifie pas que son `scenarioId` est celui demandé.

**Preuve :** sauvegarder `audit/a`, puis charger `audit:a`, restitue la proposition du premier scénario. Une seconde sauvegarde peut écraser la première. Les identifiants intégrés actuels ne sont pas démontrés en collision : le défaut concerne notamment les scénarios personnalisés. Le moteur réévalue la proposition ; ce constat ne démontre pas un contournement de la validation comportementale.

**Amélioration :** suffixer le nom lisible par un hash de l'identifiant exact ; vérifier au chargement `scenarioId`, `proposal.targetScenarioId` et la structure du document. Prévoir une migration compatible des anciennes propositions.

## 4. P2 — Recherche française encore incomplète

Le benchmark protégé `eval/harness-benchmark.mjs` confirme **16 réussites sur 17**. `voir le contenu` ne place pas `view_file` en premier. La recherche utilise des équivalences de termes dans `src/tools/tool-search.ts:120` ; ce cas manque dans la couverture actuelle.

**Amélioration :** compléter les équivalences, puis élargir les cas à des paraphrases françaises et anglaises sur le catalogue réel. Mesurer le rang et le rappel à plusieurs résultats, avec des requêtes ambiguës : corriger un seul exemple synthétique ne prouve pas une amélioration générale. Les quatre cellules programmatiques et le refus d'outil indisponible passent déjà dans ce benchmark.

## Reproduction et limites

Sonde : `node --import tsx tests/audit/recherche-reprise-2026-09-13.mjs`. Elle utilise un HOME temporaire, bloque fetch, nettoie le registre et les fixtures. Ses assertions constatent les défauts actuels : il faudra les inverser ou les remplacer par des tests de non-régression lors des correctifs.

Benchmark : `node eval/harness-benchmark.mjs`, sur le build existant de la livraison précédente. Aucun changement de source ne nécessite un nouveau build. Tests ciblés de propositions, gate et fitness : 3 fichiers, 21 tests verts. Classement : 1 fichier, 4 tests verts. Second passage de la sonde : mêmes trois défauts ; délai mesuré 1 545 ms.

Validation finale : `npm run validate` avec les quatre fichiers ciblés, exit 0 ; lint sans erreur (2 488 avertissements), contrôles TypeScript et packaging verts, 25 tests verts.

Aucun appel fournisseur, service, push ou fusion. Les journaux restent dans `_qa/audit/`, non suivis. Cette tranche n'exécute ni la suite globale ni un nouveau contrôle de données personnelles ; son échec préexistant de la livraison précédente n'est pas déclaré résolu.
