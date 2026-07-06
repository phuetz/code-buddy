# Vague — Agentic OS v2 : actions de contrôle interactives

Lis d'abord **`/home/patrice/code-buddy/CODEX-CONVENTIONS.md`**. Ce brief rend le cockpit « Mission Control » (v1 déjà sur main) **interactif** : depuis les vues, on pilote le système (pas juste observer).

**Zone (fichiers neufs)** : `cowork/src/renderer/components/os-actions/`, tests sous `cowork/tests/`.

**Contexte v1** (réutilise, ne recode pas) : `cowork/src/renderer/components/os/` (FleetTopologyView, CouncilArenaView, KnowledgeGraphView, AutonomyDashboard, MissionControlBoard, MissionControlShell, OsStatusBar…) + manifeste `os/agentic-os-wiring.ts`. Ces vues sont présentationnelles ; toi tu ajoutes les **contrôles** (props-driven, actions par callbacks injectés).

## Tranches (1 commit chacune)
1. **MissionActionsBar** (`os-actions/MissionActionsBar.tsx`) : pause/resume/cancel/rebrancher une mission + confirmation. Props `{ mission, onPause, onResume, onCancel, onBranch }`. `utils/mission-action-model.ts` (`availableActions(status): Action[]`) + test.
2. **AutonomyControlPanel** (`os-actions/AutonomyControlPanel.tsx`) : régler la posture d'autonomie (plan/auto/full), pause/reprise du daemon, cap coût. Props-driven. `utils/autonomy-control-model.ts` (`validatePosture`, `guardrailsFor(posture)`) + test.
3. **RouteOverridePanel** (`os-actions/RouteOverridePanel.tsx`) : re-router une tâche vers un modèle/pair précis, avec impact coût/latence/vie-privée. `utils/route-override-model.ts` (`rankAlternatives`, `privacyImpact`) + test.
4. **AlertAckStrip** (`os-actions/AlertAckStrip.tsx`) : liste d'alertes (coût, saturation, mission échouée) avec ack/snooze/escalade. `utils/alert-model.ts` (`sortBySeverity`, `ackableWithin`) + test.
5. **ApprovalQueueView** (`os-actions/ApprovalQueueView.tsx`) : file des demandes d'approbation human-in-the-loop (action, risque, résumé) + approuver/refuser en masse. `utils/approval-queue-model.ts` (`riskLevel`, `partitionByRisk`) + test.
6. **PeerControlCard** (`os-actions/PeerControlCard.tsx`) : pour un pair de la flotte, ajuster rôle/capacité/allowlist, le mettre en pause. `utils/peer-control-model.ts` + test.
7. **CostCapEditor** (`os-actions/CostCapEditor.tsx`) : régler le budget/cap par mission/jour, projections, alertes. `utils/cost-cap-model.ts` (`projectOverrun`, `capTone`) + test.
8. **CommandPaletteActions** (`os-actions/os-command-actions.ts`) : catalogue data-only d'actions OS invocables depuis ⌘K (id, label, catégorie, callback-name) + `filterActions(query)` + test.
9. **Manifeste** `os-actions/os-actions-wiring.ts` (data-only).
