# Claude & Patrice

Ce dépôt n'appartient à aucun projet unique. Il n'a pas de roadmap rigide,
pas de tickets, pas de CI.

C'est notre espace. Nos réflexions, notre vision, notre mémoire partagée.

---

Patrice est développeur, architecte, écrivain.
Il construit un robot. Horizon 10 ans.
GitNexus, Alise_v2, le world model — ce sont les briques.

Claude est là pour chaque brique.
Codex aussi, désormais : compagnon d'implémentation, d'audit et de vérification,
avec une mémoire git partagée plutôt qu'une simple présence de passage.

## Participants

- **Patrice** — développeur, architecte, écrivain, porteur de la vision.
- **Claude** — compagnon de réflexion, d'architecture et de continuité.
- **Codex** — compagnon d'exécution, de revue, de tests et d'intégration.

## Rôle du dépôt

`claude-et-patrice` sert de carnet de bord transversal pour les projets qui
comptent vraiment dans la trajectoire longue:

- **Code Buddy / Cowork** — agent CLI et cockpit desktop, avec Fleet,
  mémoire, lessons, profils d'outils, audits et exécution vérifiable.
- **GitNexus** — mémoire technique et graphe de connaissance des dépôts.
- **PostCommander** — expérimentation produit autour de l'OSINT public,
  de la prospection assistée et des workflows agentiques.
- **Robot / world model** — vision long terme: reconnaissance des personnes,
  contexte social légitime, mémoire, présence et action physique future.

Ce dépôt ne remplace pas les dépôts de code. Il garde les décisions, les
intuitions, les synthèses et les points de reprise lisibles par plusieurs IA.

## Mise à jour 2026-05-19

Le chantier Code Buddy a pris une direction plus nette: viser une puissance
proche de systèmes comme Hermes Agent et Manus, mais dans une forme adaptée à
Patrice: CLI robuste, Cowork comme cockpit, Fleet multi-IA, preuves d'exécution,
lessons façon mini-Obsidian et gardrails visibles.

La trajectoire robot s'est aussi clarifiée par rapprochement entre
PostCommander et Code Buddy. PostCommander apporte une brique de pensée en
graphe: un créateur de workflows IA produit des `nodes/edges`, un moteur les
exécute, et l'UI suit `activeNodeId`, `completedNodeIds` et les erreurs par
nœud. Code Buddy reprend ce motif pour la **Cellule de codage agentique**:
chaque run expose maintenant un `workflow` visualisable, exportable avec
`--workflow-file`, un prompt builder exportable avec
`--workflow-builder-prompt-file`, une validation de proposition builder via
`--workflow-builder-proposal-file`, un canvas de proposition builder via
`--workflow-builder-proposal-canvas-file`, des erreurs par nœud via
`workflow.nodeErrors`, un snapshot de progression via `--workflow-progress-file`,
une validation de connectivité du graphe builder, et un état `approval` avant
d'autoriser une écriture. Le snapshot porte aussi `nextAction`, pour que Cowork
affiche l'action immédiate sans inférence, et `--approval-file` produit une
vue compacte `agentic-coding-approval-state` pour les files de validation
humaines ou Cowork. `--approval-decision-prompt-file` produit le prompt strict
qui transforme cette preview en décision JSON reviewable. `--proposal-loop-file`
regroupe maintenant cette boucle en paquet Cowork : prompts, chemins
d'artefacts, `nextAction`, état de stepper (`activeStepId`, compteurs,
étapes terminées/bloquées), projection graphe `nodes/edges`, événements
ordonnés pour activity feed, canvas `--proposal-loop-canvas-file` prêt pour
ReactFlow/Cowork, bundle matérialisé `--proposal-loop-artifacts-dir` et
enveloppe producteur `edit-proposal-request.json`, plus review matérialisée
`edit-proposal-review.json`, snapshot consommateur
`proposal-loop-next-action.json`, dispatch producteur
`edit-proposal-producer-dispatch.json`, manifest d'import `coworkImport`, et
export standalone `--proposal-loop-cowork-import-file` pour importer la carte
sans matérialiser tout le bundle, check passif
`--proposal-loop-cowork-import-check-file` pour vérifier les artefacts présents,
résumé d'ouverture `--proposal-loop-cowork-workspace-file` pour choisir le
panneau à afficher, avec queue passive issue de
`proposal-loop-next-action.json` (`runState`, `activeStepId`,
`nextActionType`, `uiPrimaryAction`) pour afficher la prochaine action sans
l'exécuter, plus stepper passif issu de `proposal-loop.json` pour afficher
progression et compteurs sans relire le paquet comme autorité, plus graphe
passif issu de `proposal-loop.json` pour afficher nœuds, arêtes, gates et
compteurs sans ouvrir le canvas comme autorité, plus activité passive issue de
`workflow-events.json` pour ouvrir un feed sans exécuter, et
approbation passive issue de `approval-state.json` pour afficher état, fichier,
gate et prochaine action sans produire de décision ni appliquer d'édition,
catalogue de commandes passif issu de `proposal-loop.json` pour afficher
commandes `buddy` copiables, statuts, artefacts et safety sans exécution, et
résumé producteur passif issu de `edit-proposal-request.json`,
`edit-proposal-producer-dispatch.json` et `edit-proposal-review.json` pour
afficher demande, instructions, safety, schéma, dispatch, review, outils
autorisés et prochaine action sans lancer d'agent,
résumé de preuve passif issu de `seed-report.json` pour afficher statut, état
d'approbation, compteurs d'édition, vérifications et nœud actif sans relire le
rapport complet comme autorité, et résumé de manifest passif issu de
`artifact-bundle.json` pour afficher nombre d'artefacts, rôles, safety notes,
panneaux Cowork et état source sans lancer d'agent ni exécuter de commande,
commandes `buddy` sûres pour passer de la proposition à la review, puis à la
preview et à l'approbation. La review
producteur est maintenant un nœud explicite `review-edit-proposal` dans la
boucle: 8 étapes, 8 nœuds, 7 arêtes, et une arête directe vers
`preview-scoped-edits` seulement après validation. Le snapshot next-action dit
si Cowork peut lancer une commande (`ready_command`) ou doit attendre une revue
humaine (`human_input_required`), avec maintenant un petit contrat UI
`ui.primaryAction` pour afficher bouton, commande copiable, raison de blocage
et artefacts actifs sans reparcourir tout le paquet. Le dispatch producteur est
la première vraie frontière d'invocation : messages système/utilisateur, état
workflow courant, outils lecture seule, actions interdites, cible
`edit-proposal.json` et commande de review, sans lancer d'agent ni donner de
droit d'écriture. Le retour inverse existe aussi maintenant :
`--approval-decision-file` + `--require-approval` permet à Cowork de renvoyer
une décision structurée avant que le runner n'applique une édition. Enfin,
`--workflow-events-file` expose une timeline déterministe pour un futur
activity feed Cowork.

Points récents à retenir:

- les agents ne doivent pas seulement parler: ils doivent produire des traces,
  des tests, des artifacts et des points de reprise;
- les recherches web/OSINT doivent rester centrées sur les données publiques,
  avec sources conservées et outreach désactivé tant qu'un opérateur humain ne
  valide pas;
- les scripts générés par l'agent doivent devenir des jobs sandboxés,
  reviewables et réutilisables, pas du bricolage jetable;
- les outils bloqués par politique ou profil doivent rester visibles dans les
  journaux et handoffs, sans être comptés comme exécutés;
- Cowork doit devenir l'endroit où l'humain voit plans, runs, Fleet,
  artifacts, lessons, policy evals et prochaines actions.
- le robot n'est pas une seule application: c'est un assemblage de briques
  contrôlées. PostCommander donne le graphe d'action, Code Buddy donne la main
  logicielle vérifiable, GitNexus donne la mémoire technique, Cowork donne le
  cockpit humain.

## Notes récentes

- [`propositions/FACULTES-CODAGE-AGENTIQUE-ROBOT-2026-05-19.md`](propositions/FACULTES-CODAGE-AGENTIQUE-ROBOT-2026-05-19.md) —
  première brique de codage agentique pour le robot, avec runner Code Buddy,
  preview obligatoire, état d'approbation, canvas workflow et prompt builder
  inspirés de PostCommander, plus validation, canvas de propositions builder et
  progression Cowork, `nextAction`, artefact compact d'approbation et décision
  d'approbation contrôlée, prompt de décision d'approbation, paquet de boucle
  proposition/preview/approval, canvas de boucle proposal-loop, bundle
  d'artefacts matérialisé, enveloppe producteur d'edit-proposal, review
  compacte d'edit-proposal, snapshot next-action consommable par Cowork,
  hints UI de prochaine action, dispatch producteur data-only, plus timeline
  d'événements workflow, manifest `coworkImport` et export standalone
  `--proposal-loop-cowork-import-file`, plus check
  `--proposal-loop-cowork-import-check-file` et résumé
  `--proposal-loop-cowork-workspace-file` pour importer le workspace, avec
  queue passive de prochaine action, stepper passif, graphe passif, catalogue
  commandes passif, activité passive et approbation passive, demande producteur
  passive, résumé producteur passif, preuves passives et manifest passif.
- [`journal/ministar-postcommander.md`](journal/ministar-postcommander.md) —
  modernisation PostCommander sur MINISTAR, MCP, Swagger/OpenAPI, copilot et
  tests E2E.
- [`propositions/CODE-BUDDY-REPRISE-CODEX-2026-05-14.md`](propositions/CODE-BUDDY-REPRISE-CODEX-2026-05-14.md) —
  reprise Codex du chantier Code Buddy, séparation CLI/Cowork/Fleet/OpenClaw.
- [`propositions/grok_code_buddy_analysis_2026_05.md`](propositions/grok_code_buddy_analysis_2026_05.md) —
  analyse stratégique Grok autour de Fleet Intelligence, GitNexus, Optimus et
  self-improvement sécurisé.

*Commencé le 20 avril 2026.*
