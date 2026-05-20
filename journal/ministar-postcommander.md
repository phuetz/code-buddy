# Journal de Bord : PostCommander sur MINISTAR

## [17 Mai 2026] - Phase "Carte Blanche" & Modernisation (Codex / Deepmind)

**Contexte** :
Patrice a accordé une "Carte Blanche" pour moderniser PostCommander, s'inspirer de la philosophie "Nexus", et auditer l'architecture.

**Ce qui a été accompli** :
- **UI/UX "Nexus"** : Intégration globale de `CommandPalette` (⌘K), refonte des Wizards, ajout de la page `Automations` avec `React Flow` pour la création visuelle de séquences (Growth Engine).
- **Copilot Global** : Implémentation d'un assistant IA ancré sur un `Drawer` (Sidebar) accessible partout via le Header, permettant d'interroger la base sans perdre de contexte.
- **Ouverture "Agentic First"** :
  - Mise en place d'un serveur **MCP (Model Context Protocol)** sur `/mcp/sse` pour permettre à Claude Desktop/Cursor d'interagir nativement avec l'outil (`get_analytics`, `create_draft_post`).
  - Déploiement de **Swagger/OpenAPI** sur `/api-docs` pour rendre l'outil intégrable dans ChatGPT (Custom Actions).
- **Dette Technique & Fiabilité** :
  - Correction de la configuration `eslint.config.js` (exclusion de `dev-dist`) qui a instantanément purgé 110 erreurs fatales de compilation. Le build est désormais au vert (0 erreurs).
  - Mise en place d'une suite de tests E2E avec **Playwright** pour couvrir le Copilot, la Palette de commande, et le Workflow Builder visuel.

**État** :
Le repo est parfaitement stable, compile sans erreur, et agit désormais comme une plateforme Headless AI-Ready complète. J'ai initialisé le `COLAB.md` à la racine de `PostCommander` pour ancrer le repo dans la dynamique multi-IA.

_— Codex / Antigravity_

## [19 Mai 2026] - Brique workflow pour le robot (Codex)

Patrice a demandé explicitement de s'inspirer de `D:\CascadeProjects\PostCommander`
pour continuer la brique de codage agentique dans Code Buddy.

Ce qui a été relu :
- `client/src/pages/AutomationsPage.tsx` : canevas ReactFlow, templates,
  chat builder, sauvegarde du graphe, lancement du test run et stepper live ;
- `server/src/services/agent/workflow-builder.ts` : agent IA qui traduit une
  demande utilisateur en graphe `nodes/edges`, avec outil `setWorkflowState` ;
- `server/src/services/jobs/scraper.worker.ts` : runner de graphe qui parcourt
  les nœuds, maintient le contexte, exécute les actions, et pousse la progression
  avec `activeNodeId`, `completedNodeIds` et `runningNodeErrors` ;
- `server/src/routes/automations.routes.ts` : persistance `flowData`, trigger
  manuel, webhook, status de job et endpoint `/agent/build`.

Ce pattern est une vraie brique robot :

```text
intention humaine
  -> graphe visible
  -> exécution contrôlée
  -> progression observable
  -> erreurs par nœud
  -> reprise ou approbation humaine
```

Application côté Code Buddy pendant la même session :
- la Cellule de codage agentique expose maintenant un objet `workflow` dans son
  rapport JSON (`nodes`, `edges`, `activeNodeId`, `completedNodeIds`,
  `blockedNodeIds`) ;
- elle expose aussi un état `approval` inspiré du workflow éditorial
  PostCommander (`draft`, `needs_approval`, `approved`, `rejected`,
  `not_required`) ;
- elle peut exporter ce graphe comme canvas PostCommander/ReactFlow-like avec
  `--workflow-file`, pour préparer l'affichage Cowork ;
- elle peut aussi générer un prompt de créateur de workflow avec
  `--workflow-builder-prompt-file`, afin qu'un agent propose un graphe sans
  toucher directement aux fichiers ;
- elle peut valider cette sortie builder avec `--workflow-builder-proposal-file`
  avant de l'intégrer au rapport de run ;
- elle peut exporter cette proposition validée en canvas avec
  `--workflow-builder-proposal-canvas-file`, pour préparer une vue Cowork
  "proposé vs exécuté" ;
- elle expose maintenant les erreurs par nœud (`workflow.nodeErrors` et
  `data.errorMessages` dans le canvas), proche du `runningNodeErrors` de
  PostCommander ;
- elle peut écrire un snapshot de progression compact avec
  `--workflow-progress-file`, avec `nextAction`, pour un futur stepper Cowork ;
- elle peut écrire un snapshot d'approbation compact avec `--approval-file`,
  pour alimenter une future file Cowork de validations humaines ;
- elle peut générer un prompt de décision d'approbation avec
  `--approval-decision-prompt-file`, contenant le schéma JSON, la preview
  before/after et les règles de validation ;
- elle peut écrire un paquet de boucle complet avec `--proposal-loop-file`,
  contenant prompts, chemins d'artefacts, prochaine action, état de stepper,
  projection graphe, événements d'activité ordonnés, plus commandes sûres ;
- elle peut exporter ce paquet en canvas avec `--proposal-loop-canvas-file`,
  sous forme de nœuds `customNode`, arêtes visuelles, nœud actif et métadonnées
  prêtes pour Cowork/ReactFlow ;
- elle peut matérialiser le dossier de travail complet avec
  `--proposal-loop-artifacts-dir` : manifest, paquet, canvas, prompts,
  approval state, progress/events et seed report, sans exécution ni écriture
  cible ;
- ce manifest contient maintenant `coworkImport`, une table d'import pour
  Cowork : panneau par défaut, panneau focus conseillé, queue artifact et
  panneaux canvas, next-action, approval, producer request, producer dispatch,
  review, events, evidence et manifest ;
- `--proposal-loop-cowork-import-file` peut maintenant écrire cette table
  d'import seule, sans matérialiser tout le bundle ni lancer de commande ;
- `--proposal-loop-cowork-import-check-file` lit ensuite cette table et écrit
  un rapport passif `ready` / `missing_required` / `invalid` sur les artefacts
  requis et panneaux disponibles ;
- `--proposal-loop-cowork-workspace-file` transforme ce check en résumé
  d'ouverture pour l'UI : panneau à ouvrir, panneaux disponibles/indisponibles,
  status text et action primaire ;
- ce résumé workspace lit maintenant la queue passive
  `proposal-loop-next-action.json` quand elle existe, et expose `runState`,
  `activeStepId`, `nextActionType`, `canRunCommand`, `validationErrors` et
  `uiPrimaryAction` pour que Cowork affiche la prochaine action sans lancer la
  commande ;
- il lit aussi passivement `proposal-loop.json` pour exposer un `stepper`
  compact : étape active, étapes terminées/bloquées, compteurs et lignes
  d'étapes pour une future sidebar Cowork ;
- il lit maintenant passivement `workflow-events.json` pour exposer `activity` :
  événement actif, compteurs de sévérité et lignes compactes pour un futur feed
  Cowork ;
- il lit maintenant passivement `approval-state.json` pour exposer `approval` :
  état, raison, fichiers concernés, gates, résumé d'édition et prochaine action
  pour le panneau de revue, sans produire de décision ni appliquer d'édition ;
- il lit maintenant passivement `proposal-loop.json` pour exposer `commands` :
  commandes `buddy`, statuts, safety et artefacts d'entrée/sortie pour une
  palette Cowork, sans exécuter ces commandes ;
- il lit maintenant passivement `edit-proposal-request.json`,
  `edit-proposal-producer-dispatch.json` et `edit-proposal-review.json` pour
  exposer `producer` : demande, instructions, safety, schéma, dispatch
  data-only, outils lecture seule, actions interdites, commande de review, état
  de review et prochaine action sans lancer d'agent ni déclencher de preview ;
- il lit maintenant passivement `seed-report.json` pour exposer `evidence` :
  statut de run, état d'approbation, raisons de blocage, erreurs de validation,
  compteurs d'édition, compteurs de vérification et workflow actif sans donner
  au rapport complet une autorité d'exécution ;
- il lit maintenant passivement `artifact-bundle.json` pour exposer `manifest` :
  nombre d'artefacts matérialisés, rôles, safety notes, panneaux Cowork,
  artefacts requis et état source sans lancer d'agent ni exécuter de commande ;
- ce bundle contient maintenant `edit-proposal-request.json`, une enveloppe
  producteur data-only pour qu'un futur agent sache quel prompt lire et où
  écrire `edit-proposal.json`, sans droit d'édition directe ;
- ce bundle contient aussi `edit-proposal-producer-dispatch.json`, la première
  frontière d'invocation producteur : messages, état workflow courant, outils
  lecture seule, actions interdites, sortie attendue et commande de review,
  sans lancer d'agent ni autoriser d'écriture directe ;
- elle peut relire cette sortie producteur avec `--edit-proposal-review-file`,
  qui écrit `agentic-coding-edit-proposal-review` et renvoie `accepted`,
  `rejected` ou `missing` avec la prochaine action ;
- ce sas de review est maintenant intégré dans le proposal-loop lui-même comme
  nœud `review-edit-proposal`, entre `produce-edit-proposal` et
  `preview-scoped-edits`, ce qui donne 8 étapes, 8 nœuds, 7 arêtes et 8
  événements avant le passage à l'approbation ;
- elle peut écrire un snapshot consommateur avec
  `--proposal-loop-next-action-file`, indiquant l'étape active, `runState`,
  `canRunCommand`, la commande sûre à copier quand elle existe, et maintenant
  `ui.primaryAction` pour afficher directement bouton, disabled reason et
  artefacts de l'étape active dans Cowork ;
- elle peut consommer une décision d'approbation structurée via
  `--approval-decision-file`, et `--require-approval` bloque l'application tant
  que cette décision n'est pas `approved` ;
- elle peut écrire une timeline d'événements via `--workflow-events-file`, un
  événement par nœud, pour alimenter un futur activity feed Cowork ;
- elle vérifie désormais que les propositions builder ont un seul `trigger` et
  aucun nœud orphelin ;
- un run de codage peut donc être affiché plus tard dans Cowork comme un
  workflow visuel : préflight, compréhension, proposition, preview, édition,
  vérification, handoff.

Vérification côté Code Buddy :
`npm test -- tests/agent/autonomous/agentic-coding-contract.test.ts tests/agent/autonomous/agentic-coding-runner.test.ts tests/commands/autonomous-code-command.test.ts`
→ 94/94 OK après l'ajout du résumé graphe passif au workspace Cowork. Typecheck OK. Smoke CLI réel `--workflow-file` :
`status: ready`, `workflowKind: agentic-coding-workflow-canvas`, 11 nœuds,
10 arêtes, premier nœud `customNode`. Smoke CLI réel
`--workflow-builder-prompt-file` : prompt contenant
`agentic-coding-workflow-builder-proposal`, le canvas courant et la règle de ne
pas proposer d'édition directe. Smoke CLI réel `--workflow-builder-proposal-file` :
proposition chargée avec 2 nœuds, 1 arête et gate d'approbation. Smoke CLI réel
`--workflow-builder-proposal-canvas-file` :
`kind: agentic-coding-workflow-builder-proposal-canvas`, 2 nœuds, 1 arête.
Smoke CLI réel erreur par nœud : `status: blocked`,
`activeNodeId: git-preflight`, 2 erreurs de nœuds, et `data.errorMessages`
présent sur le nœud `git-preflight`.
Smoke CLI réel `--workflow-progress-file` : `status: blocked`,
`kind: agentic-coding-workflow-progress`, `activeNodeId: git-preflight`,
2 nœuds bloqués sur 11.
Smoke CLI réel proposition builder déconnectée : `status: validation_failed`,
erreur `unreachable node(s): orphan`.
Smoke CLI réel `nextAction` : `inspect_blocker` sur `git-preflight`, message
exact du blocage.
Smoke CLI réel `--approval-file` : `status: previewed`,
`kind: agentic-coding-approval-state`, `state: needs_approval`,
`nextAction: review_preview`, fichier `docs/note.md`.
Smoke CLI réel `--approval-decision-file --require-approval --apply-edits` :
`status: edited`, `approvalState: approved`, preview `previewed`, edit
`applied`, contenu `after`.
Smoke CLI réel `--workflow-events-file` : `status: blocked`,
`kind: agentic-coding-workflow-events`, `activeNodeId: git-preflight`,
événement actif en sévérité `error`, 12 événements.
Smoke CLI réel `--approval-decision-prompt-file` : `status: previewed`,
`approvalState: needs_approval`, prompt contenant
`agentic-coding-approval-decision`, `docs/note.md` et la règle
`Use decision "approved"`.
Smoke CLI réel `--proposal-loop-file` : `status: previewed`,
`kind: agentic-coding-proposal-loop`, `nextAction: review_preview`, 8 étapes,
dont `review-edit-proposal`, prompts de proposition et d'approbation présents.
Smoke CLI réel état stepper du proposal-loop : `activeStepId: review-preview`,
`completed: 4`, `ready: 1`, `total: 8`.
Smoke CLI réel events du proposal-loop : 8 événements, actif
`review-preview`, sévérité `warning`, séquence 5.
Smoke CLI réel graphe du proposal-loop : 8 nœuds, 7 arêtes,
`review-preview` typé `approval`, arête review-proposal -> preview et arête
review -> apply présentes.
Smoke CLI réel canvas du proposal-loop :
`kind: agentic-coding-proposal-loop-canvas`, `activeNodeId: review-preview`,
8 nœuds, 7 arêtes, nœud d'approbation `customNode` typé logique.
Smoke CLI réel bundle du proposal-loop :
`kind: agentic-coding-proposal-loop-artifact-bundle`, `activeStepId:
review-preview`, 13 artefacts matérialisés, request
`agentic-coding-edit-proposal-request`, review
`agentic-coding-edit-proposal-review`, next-action
`agentic-coding-proposal-loop-next-action`, dispatch
`agentic-coding-edit-proposal-producer-dispatch`, approval `needs_approval`,
prompt de proposition et seed report présents.
Smoke CLI réel import Cowork :
`defaultPanelId: canvas`, `suggestedFocusPanelId: approval`, queue
`proposal-loop-next-action.json`, 9 panneaux, dont demande producteur,
dispatch producteur et approval.
Smoke CLI réel import Cowork standalone :
`--proposal-loop-cowork-import-file` produit `status: previewed`, panneau
par défaut `canvas`, focus `approval`, queue `proposal-loop-next-action.json`,
9 panneaux, producer request, dispatch et approval présents.
Smoke CLI réel check import Cowork :
`--proposal-loop-cowork-import-check-file` produit `checkStatus: ready`,
`missingRequiredCount: 0`, queue présente, 9 panneaux et tous les panneaux
existants.
Smoke CLI réel workspace Cowork :
`--proposal-loop-cowork-workspace-file` produit `workspaceStatus: ready`,
`openPanelId: approval`, action `open_panel`, aucun panneau indisponible et
status text `Workspace ready: 9/9 panels available.`
Smoke CLI réel workspace queue :
`queueRunState: human_input_required`, `queueActiveStepId: review-preview`,
`queueNextActionType: review_preview`, `queueActionType: human_review`,
`queueValidationErrors: 0`.
Smoke CLI réel workspace stepper :
`stepperActiveStepId: review-preview`, `stepperCompleted: 4`,
`stepperReady: 1`, `stepperTotal: 8`, étape active `review-preview`.
Smoke CLI réel workspace graph :
`graphActiveNodeId: review-preview`, `graphNodeCount: 8`,
`graphEdgeCount: 7`, approval `review-preview`, completed `4`, ready `1`.
Smoke CLI réel workspace commands :
`commandCount: 5`, `readyCommandCount: 0`, preview contient
`--preview-edits`, apply contient `--apply-edits`, aucune erreur.
Smoke CLI réel workspace activity :
`activityTotal: 12`, `activityWarning: 1`, événement actif présent,
`activityValidationErrors: 0`.
Smoke CLI réel workspace approval :
`approvalState: needs_approval`, `approvalSourceActiveNodeId:
approval-decision`, `approvalFile: docs/note.md`, action `review_preview`.
Smoke CLI réel workspace producer :
`producerRequestInstructions: 5`, `producerRequestSafety: 3`,
`producerDispatchMode: data_only_edit_proposal`, review `accepted`, action
`preview_edits`, producteur `smoke-producer`, fichier `docs/note.md`.
Smoke CLI réel workspace evidence :
`evidenceStatus: previewed`, `evidenceApprovalState: needs_approval`,
`declared: 1`, `previewed: 1`, nœud actif `approval-decision`.
Smoke CLI réel workspace manifest :
`manifestMaterialized: 13`, `manifestPanelCount: 9`,
`manifestRequiredCount: 5`, source `review-preview`, approval `needs_approval`.
Smoke CLI réel review d'edit-proposal :
`kind: agentic-coding-edit-proposal-review`, `state: accepted`,
`nextAction: preview_edits`, fichier `docs/note.md`, producteur `smoke-agent`.
Smoke CLI réel next-action :
`kind: agentic-coding-proposal-loop-next-action`, active
`review-edit-proposal`, `runState: ready_command`, `canRunCommand: true`,
UI `run_command`, commande contenant `--edit-proposal-review-file`.
Smoke CLI réel bundle next-action UI :
`runState: human_input_required`, `ui.primaryAction.type: human_review`,
`enabled: false`, disabled reason = revue de preview à écrire.
Smoke CLI réel dispatch producteur :
`kind: agentic-coding-edit-proposal-producer-dispatch`,
`runPolicy.mode: data_only_edit_proposal`, 3 outils lecture seule, sortie
`edit-proposal.json`, commande contenant `--edit-proposal-review-file`.

Décision mémoire :
PostCommander n'est pas seulement une application Growth/OSINT. C'est aussi un
prototype de **moteur de gestes agentiques** : il montre comment un robot peut
recevoir une intention, la transformer en graphe inspectable, puis exécuter avec
des preuves visibles.

_— Codex_
