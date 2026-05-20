# Facultés de codage agentique pour le robot

> **Statut** : proposition initiale — à valider avec Patrice
> **Date** : 2026-05-19
> **Auteur** : Codex
> **Contexte** : continuité de la vision robot 10 ans. Objectif : donner au futur système une capacité autonome de comprendre, modifier, tester et améliorer du code, sans perdre les garde-fous humains.
> **Avancée** : R1 lancé dans Code Buddy avec `docs/agentic-coding-cell.md`.
> Premier runner V0 ajouté et testé : contrat, préflight, gate de sécurité, plan structuré, graphe workflow inspiré de PostCommander, état d'approbation, prompt de proposition, fichier de proposition d'édition, review `--edit-proposal-review-file`, preview dry-run, preview obligatoire avant écriture, édition scoped déclarative, rapport JSON persistant, export canvas `--workflow-file`, prompt builder `--workflow-builder-prompt-file`, validation builder `--workflow-builder-proposal-file`, canvas builder `--workflow-builder-proposal-canvas-file`, erreurs par nœud `workflow.nodeErrors`, snapshot `--workflow-progress-file`, `nextAction`, timeline `--workflow-events-file`, artefact d'approbation `--approval-file`, prompt de décision `--approval-decision-prompt-file`, paquet de boucle `--proposal-loop-file`, étape explicite `review-edit-proposal`, canvas de boucle `--proposal-loop-canvas-file`, bundle d'artefacts `--proposal-loop-artifacts-dir`, enveloppe `edit-proposal-request.json`, dispatch producteur `edit-proposal-producer-dispatch.json`, manifest `coworkImport`, export standalone `--proposal-loop-cowork-import-file`, check passif `--proposal-loop-cowork-import-check-file`, résumé workspace `--proposal-loop-cowork-workspace-file` avec queue passive de prochaine action, stepper passif, graphe passif, catalogue commandes passif, activité passive, approbation passive, producteur passif, preuves passives et manifest passif, artefact `edit-proposal-review.json`, snapshot consommateur `proposal-loop-next-action.json` avec hints UI Cowork, décision d'approbation `--approval-decision-file` + `--require-approval`, validation de connectivité builder, commande `buddy autonomous-code --task-file`.

---

## Intention

Le robot ne doit pas seulement exécuter des scripts écrits par Patrice. Il doit
apprendre à agir sur son propre environnement logiciel : lire un dépôt,
comprendre une intention, proposer un plan, modifier le code, vérifier, garder
une trace, puis apprendre de ce qui a marché.

Cette faculté est une étape avant l'incarnation physique complète. Avant de
manipuler le monde avec des bras, il doit savoir manipuler proprement ses
propres outils numériques.

Formule simple :

```text
GitNexus = mémoire technique
Code Buddy = moteur d'action agentique
Fleet = intelligence distribuée
Cowork = cockpit humain
Robot = continuité incarnée
```

---

## Facultés à créer

### F0 — Conscience du périmètre

Le système doit savoir où il travaille, ce qu'il a le droit de toucher, et ce
qui est hors limites.

Capacités :
- identifier le dépôt actif et ses règles (`AGENTS.md`, `COLAB.md`, `CLAUDE.md`, README) ;
- détecter les fichiers modifiés avant lui ;
- refuser les actions destructives non demandées ;
- produire un journal clair des décisions.

### F1 — Lecture technique augmentée

Le robot doit pouvoir lire un codebase sans dépendre seulement du contexte
court du LLM.

Capacités :
- interroger GitNexus pour symboles, flux, dépendances, impacts ;
- lire les fichiers sources exacts avant toute conclusion ;
- citer les preuves : fichiers, fonctions, tests, commits ;
- distinguer "je sais" de "j'infère".

### F2 — Planification exécutable

Le système doit transformer une intention vague en tâches vérifiables.

Capacités :
- découper une demande en étapes courtes ;
- choisir la voie : solo, sous-agent, fleet, ou humain ;
- définir des critères d'acceptation ;
- prévoir tests, rollback, risques et limites.

### F3 — Main logicielle autonome

C'est la vraie faculté de codage agentique : modifier le monde logiciel avec
prudence.

Cycle minimal :

```text
1. Lire les règles et l'état git
2. Créer ou choisir une branche
3. Comprendre le code concerné
4. Ajouter ou verrouiller un test
5. Modifier le code
6. Lancer lint/typecheck/tests ciblés
7. Corriger jusqu'au vert
8. Résumer preuves + risques
9. Commit Lore si demandé ou si workflow l'exige
10. Écrire les leçons utiles en mémoire
```

### F4 — Auto-revue et mémoire

Un agent autonome sans mémoire refait les mêmes erreurs. La faculté doit donc
écrire ses apprentissages.

Capacités :
- enregistrer les décisions importantes dans `claude-et-patrice` ou mémoire projet ;
- ajouter des lessons réutilisables dans Code Buddy ;
- produire un handoff court si le contexte devient long ;
- maintenir une liste des risques ouverts.

### F5 — Délégation distribuée

Une seule IA ne suffit pas pour la trajectoire robot. Il faut une petite flotte
avec rôles.

Rôles possibles :
- **Code Buddy local** : exécution, tests, outils ;
- **GitNexus** : mémoire et analyse structurelle ;
- **Claude** : architecture, jugement, continuité ;
- **Codex** : implémentation, revue, vérification ;
- **Gemini** : volume documentaire et long contexte ;
- **Ollama local** : tâches rapides, privées, répétables ;
- **Cowork** : cockpit humain, preuves, runs, artifacts.

### F6 — Passage vers le robot

Quand le robot aura voix, vision et action physique, cette faculté devra rester
encapsulée.

Principe : le robot peut améliorer son logiciel, mais les actions physiques,
réseau, sécurité, données personnelles et déploiements doivent passer par des
politiques visibles et auditées.

---

## MVP proposé : Autonomous Coding Cell V0

Créer dans Code Buddy une cellule autonome de codage qui prend une tâche courte
et livre un résultat vérifié.

Entrée :

```json
{
  "repo": "D:/CascadeProjects/grok-cli-weekend",
  "task": "Corriger le bug X ou ajouter la capacité Y",
  "allowedPaths": ["src/...", "tests/..."],
  "verification": ["npm run typecheck", "npm test -- path"],
  "riskLevel": "low|medium|high"
}
```

Sortie :

```json
{
  "status": "completed|blocked",
  "summary": "...",
  "filesChanged": ["..."],
  "testsRun": ["..."],
  "evidence": ["..."],
  "risks": ["..."],
  "nextSteps": ["..."]
}
```

Garde-fous V0 :
- pas de push automatique ;
- pas de suppression récursive ;
- pas de modification hors `allowedPaths` ;
- pas de secrets dans les logs ;
- arrêt si tests impossibles à exécuter ;
- rollback ou blocage si le diff sort du périmètre ;
- journalisation complète du plan, des outils appelés et des preuves.

---

## Première tranche concrète

### R1 — Documenter le protocole dans Code Buddy

Créer `docs/agentic-coding-cell.md` avec :
- cycle d'exécution ;
- format d'entrée/sortie ;
- niveaux de risque ;
- permissions ;
- exemples de tâches.

### R2 — Implémenter un runner interne minimal

Ajouter une commande expérimentale :

```bash
buddy autonomous-code --task-file task.json
```

Le runner peut d'abord être un orchestrateur strict qui réutilise les briques
existantes de Code Buddy : lecture fichier, search, apply patch, shell safe,
tests, mémoire, logs.

État 2026-05-19 : le contrat d'entrée, la porte de sécurité V0 et le runner
préflight/rapport existent déjà. La commande expérimentale
`buddy autonomous-code --task-file task.json` est câblée, avec vérification
explicite via `--run-verification`, plan d'exécution structuré dans le rapport,
proposition externe contrôlée via `--edit-proposal-file`, édition scoped
déclarative via `--apply-edits`, preview sans écriture via `--preview-edits`,
prévisualisation obligatoire avec `--require-preview` avant application,
génération d'un prompt contraint via `--proposal-prompt-file`, et persistance
via `--report-file <path>`. Inspiré du moteur de workflows PostCommander, le
rapport expose aussi un objet `workflow` avec `nodes`, `edges`,
`activeNodeId`, `completedNodeIds` et `blockedNodeIds`, ainsi qu'un état
`approval` (`draft`, `needs_approval`, `approved`, `rejected`,
`not_required`). La commande peut aussi écrire un canvas
PostCommander/ReactFlow-like via `--workflow-file <path>` :
`kind: agentic-coding-workflow-canvas`, nœuds `customNode`, positions,
icônes et statuts de run. Elle peut aussi écrire un prompt de créateur de
workflow via `--workflow-builder-prompt-file <path>` ; ce prompt demande un
JSON `agentic-coding-workflow-builder-proposal` et interdit les éditions
directes. Elle peut ensuite valider ce JSON via
`--workflow-builder-proposal-file <path>` : unicité des ids de nœuds et arêtes
référençant des nœuds existants. La proposition validée peut enfin devenir un
canvas séparé via `--workflow-builder-proposal-canvas-file <path>`, pour que
Cowork distingue "workflow proposé" et "workflow exécuté". La prochaine étape R2
est donc de brancher une
boucle agentique qui consomme ce prompt et produit le fichier de proposition,
toujours sans donner au modèle le droit d'écrire directement, puis de faire
consommer ce canvas par Cowork. Le workflow exécuté porte aussi les erreurs par
nœud (`workflow.nodeErrors` et `data.errorMessages`) afin que Cowork puisse
afficher la cause du blocage sur la carte concernée. Pour une vue live plus
légère, `--workflow-progress-file <path>` écrit un snapshot
`agentic-coding-workflow-progress` avec nœud actif, compteurs, nœuds terminés,
nœuds bloqués, erreurs et `nextAction` pour l'interface. Les propositions
builder sont aussi vérifiées comme graphes exécutables : exactement un nœud
`trigger`, aucun nœud orphelin. Pour la file de validation humaine ou Cowork,
`--approval-file <path>` écrit aussi `agentic-coding-approval-state` : état
`draft` / `needs_approval` / `approved` / `rejected` / `not_required`, raison,
fichiers concernés, compteurs de preview/apply, nœuds de validation et
`nextAction` (`review_preview`, `inspect_rejection`, `preview_required` ou
`none`). Le prompt `--approval-decision-prompt-file <path>` transforme la
preview en demande de revue bornée : schéma
`agentic-coding-approval-decision`, contrat, état courant, before/after et
règles de décision. `--proposal-loop-file <path>` regroupe maintenant la route
complète sous forme d'artefact `agentic-coding-proposal-loop` : prompts,
chemins attendus, prochaine action, état de stepper (`activeStepId`, compteurs,
étapes terminées/bloquées), projection graphe `nodes/edges`, événements
ordonnés pour activity feed et commandes `buddy autonomous-code` pour préparer,
valider la proposition, prévisualiser, approuver, appliquer et vérifier. La
validation de sortie producteur est maintenant un nœud explicite
`review-edit-proposal` entre `produce-edit-proposal` et
`preview-scoped-edits` : la boucle compte 8 étapes, 8 nœuds et 7 arêtes, et
la preview n'arrive qu'après ce sas de review. L'option
`--proposal-loop-canvas-file <path>` exporte la même boucle en canvas
Cowork/ReactFlow :
`agentic-coding-proposal-loop-canvas`, nœuds `customNode`, arêtes visuelles,
nœud actif `review-preview` et étape d'approbation marquée comme logique.
`--proposal-loop-artifacts-dir <path>` matérialise enfin le dossier de travail :
manifest `agentic-coding-proposal-loop-artifact-bundle`, paquet loop, canvas,
prompts, état d'approbation, snapshots progress/events, rapport seed,
`edit-proposal-request.json`, `edit-proposal-producer-dispatch.json`,
`edit-proposal-review.json` et `proposal-loop-next-action.json`. Le premier est la frontière consommable
par Cowork ou un agent producteur de `edit-proposal.json` : il dit quel prompt
lire, quel fichier écrire, quel schéma respecter, et rappelle que le runner
garde preview, approbation et apply. Aucun droit d'écriture direct n'est donné.
Le manifest contient aussi `coworkImport`, pour dire à Cowork quel panneau
ouvrir et quel artefact utiliser : canvas, prochaine action, approval,
producer request, producer dispatch, review, events, evidence et manifest.
`--proposal-loop-cowork-import-file <path>` peut écrire cette même carte
d'import seule : Cowork obtient `defaultPanelId`, `suggestedFocusPanelId`,
`queueArtifactPath`, artefacts requis et 9 panneaux sans matérialiser le
dossier complet ni déclencher une commande.
`--proposal-loop-cowork-import-check-file <path>` ajoute la première lecture
côté consommateur : le runner relit le manifest, vérifie la présence des
artefacts requis et des panneaux, puis écrit un statut `ready`,
`missing_required` ou `invalid` sans ouvrir ces artefacts comme des commandes.
`--proposal-loop-cowork-workspace-file <path>` transforme ce check en état
d'ouverture UI : panneau recommandé (`openPanelId`), panneaux disponibles,
panneaux indisponibles et action primaire (`open_panel`, `resolve_missing` ou
`fix_import`). Quand `proposal-loop-next-action.json` existe, ce workspace
porte aussi une queue passive : `runState`, `activeStepId`, `nextActionType`,
`canRunCommand`, `validationErrors` et `uiPrimaryAction`. Une éventuelle
commande reste du texte affichable ou copiable, jamais une exécution. Quand
`proposal-loop.json` existe, le même workspace porte aussi un stepper passif :
étape active, compteurs, étapes terminées/bloquées et lignes compactes.
Quand `proposal-loop.json` existe, il porte aussi un graphe passif : nœud actif,
nœuds, arêtes, gates approval, blocages et compteurs de statut, sans ouvrir le
canvas comme autorité d'action.
Quand `workflow-events.json` existe, il porte aussi une activité passive :
événement actif, compteurs de sévérité et lignes d'événements compactes.
Quand `approval-state.json` existe, il porte aussi une approbation passive :
état, raison, fichiers concernés, gates, résumé d'édition et prochaine action
du panneau de revue, sans produire de décision ni appliquer d'édition.
Quand `proposal-loop.json` existe, il porte aussi un catalogue commandes
passif : commandes `buddy`, statuts, safety et artefacts d'entrée/sortie, sans
exécuter ces commandes.
Quand `edit-proposal-request.json`, `edit-proposal-producer-dispatch.json` et
`edit-proposal-review.json` existent, il porte aussi un producteur passif :
demande, instructions, safety, schéma, dispatch data-only, outils lecture seule,
actions interdites, commande de review, état de review, fichiers concernés et
prochaine action, sans lancer d'agent ni déclencher de preview.
Quand `seed-report.json` existe, il porte aussi des preuves passives : statut
de run, état d'approbation, blocages, validations, compteurs d'édition,
vérifications et workflow actif, sans traiter le rapport complet comme une
autorité d'exécution.
Quand `artifact-bundle.json` existe, il porte aussi un manifest passif : nombre
d'artefacts matérialisés, rôles, safety notes, panneaux Cowork, artefacts requis
et état source, sans lancer d'agent ni exécuter de commande.
Le dispatch producteur est la frontière d'invocation suivante : il emballe la
demande en messages, état workflow courant, outils lecture seule, actions
interdites, sortie attendue et commande de review, sans lancer l'agent ni
accorder d'écriture directe.
`--edit-proposal-review-file <path>` ajoute ensuite le sas de validation de
sortie producteur : `agentic-coding-edit-proposal-review` indique si la
proposition est `accepted`, `rejected` ou `missing`, avec prochaine action
`preview_edits`, `fix_edit_proposal` ou `produce_edit_proposal`. Cowork peut
donc contrôler la réponse de l'agent avant de déclencher une preview.
`--proposal-loop-next-action-file <path>` donne ensuite à Cowork le petit
résumé consommateur : étape active, prochaine action, `runState` et
`canRunCommand`. Il expose une commande copiable quand l'étape est prête, mais
ne l'exécute jamais. Il porte maintenant aussi `ui.primaryAction` :
bouton activé/désactivé, type `run_command` ou `human_review`, raison de
désactivation et artefacts d'entrée/sortie de l'étape active.
Le retour inverse est
également borné : Cowork peut écrire un JSON
`agentic-coding-approval-decision`, puis le runner applique seulement avec
`--require-approval` si cette décision vaut `approved`. Une décision `rejected`
bloque l'écriture et devient visible comme nœud d'approbation bloqué. Pour
l'affichage Cowork, `--workflow-events-file <path>` écrit aussi
`agentic-coding-workflow-events`, une timeline ordonnée avec un événement par
nœud, sévérité et message.

### R3 — Brancher GitNexus

Avant de modifier du code, le runner demande à GitNexus :
- quels fichiers sont probablement concernés ;
- quels symboles dépendent du changement ;
- quels tests ou modules sont à surveiller.

### R4 — Exposer dans Cowork

Cowork doit montrer :
- tâche courante ;
- plan ;
- diff ;
- tests lancés ;
- erreurs ;
- décision humaine demandée si le risque monte.

---

## Critères de réussite

La V0 est réussie si Patrice peut donner une tâche simple et obtenir :
- un diff limité ;
- des tests passés ;
- un rapport compréhensible ;
- aucune surprise hors scope ;
- un point de reprise si l'agent bloque.

La V1 commence seulement quand la V0 réussit plusieurs fois sur des tâches
réelles de Code Buddy ou GitNexus.

---

## Ce qu'on ne fait pas encore

- Pas d'auto-déploiement.
- Pas d'auto-push.
- Pas de modification de fichiers système.
- Pas d'action physique.
- Pas de boucle d'auto-amélioration sans revue.

L'autonomie vient par couches. La première victoire n'est pas que le robot fasse
tout seul. C'est qu'il fasse une petite chose seul, correctement, avec preuves,
et qu'on puisse lui faire confiance pour recommencer.
