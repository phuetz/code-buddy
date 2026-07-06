# Brief — « Mission Control » : le tableau de bord de l'OS agentique (Cowork)

Tu es **GPT-5.5 (Codex)**. Tu construis une grande vague de vues « **Mission Control** » pour **Cowork** (la GUI Electron de Code Buddy) : le cockpit qui donne à Cowork l'allure d'un **OS agentique** — visualiser et piloter la flotte multi-IA, le council, la mémoire collective, l'autonomie 24/7, les missions, les coûts. Chaque vue rend RICHEMENT un aspect du système (au lieu de logs bruts), façon dashboard d'infrastructure.

Tu produis des **fichiers NEUFS**, props-driven, testés. **Tu ne câbles RIEN dans les god-files** — l'intégrateur (Fable) montera tout via ton manifeste.

## ⚠️ TU ES DÉJÀ DANS TON WORKTREE ISOLÉ
Tu tournes dans `/home/patrice/agenticos-wt` sur la branche `feat/cowork-agentic-os`. **NE FAIS PAS `git worktree add`. NE CHANGE PAS DE BRANCHE. NE FAIS PAS `git checkout -b`.** Tu commits directement sur la branche courante. (Un autre agent travaille en parallèle dans un autre worktree — si tu changes de branche ou crées un worktree, tu provoques une course git.)

## Modèle de travail
- **UNE tranche = UN commit atomique.** Fais le maximum, dans l'ordre. Batch partiel OK.
- Après CHAQUE tranche : `cd cowork && npx tsc --noEmit`. Ne considère QUE les erreurs dans des fichiers `cowork/` ; ignore les erreurs environnementales `Cannot find module 'openai'/'chalk'/'open'` (elles viennent du `node_modules` racine absent dans le worktree, hors de ton périmètre).
- **NE PUSH JAMAIS. NE MERGE JAMAIS.** Commits sur `feat/cowork-agentic-os`, c'est tout.

## Contraintes DURES
1. **Fichiers NEUFS uniquement**, TOUS sous `cowork/src/renderer/components/os/` (composants ET modules logiques ET sous-dossier utils : `os/util/`). Tests sous `cowork/tests/`. **Ne crée AUCUN fichier hors de `cowork/src/renderer/components/os/` et `cowork/tests/`.**
2. **INTERDIT de modifier un fichier existant.** Zéro god-file (`App.tsx`, `store/index.ts`, `preload/index.ts`, `NewShell.tsx`, `main/index.ts`), zéro `i18n/locales/*.json`, zéro `package.json`, zéro noyau `src/`. Que du neuf.
3. **Découplage total** : chaque composant est **props-driven** — données par props typées, actions par callbacks (`onSelect`, `onPause`…). **Aucun accès au store Zustand, aucun `window.electronAPI`.** Un composant qui a besoin de données live reçoit une prop + un **état vide honnête**.
4. `git add` **explicite fichier par fichier**. Ne touche jamais `.codebuddy/*`, `ETUDE-*.md`, `buddy-memory/`, `COWORK-*BRIEF*.md`.
5. Trailer de commit exact :
   ```
   Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
   Claude-Session: https://claude.ai/code/session_01Wten2ENavfScZnAfZRCSix
   ```
   Conventional Commits : `feat(cowork): <slice>`.

## Conventions Cowork
- TS strict, single quotes, semicolons, 2-space indent, imports ESM `.js`.
- **Style** = Tailwind tokens sémantiques (voir `cowork/src/renderer/components/SciencePanel.tsx`, `FleetCommandCenter.tsx`, `MessageCard.tsx`) : `bg-surface`, `bg-muted`, `text-muted-foreground`, `border-border`, `bg-primary`, `text-foreground`. Statuts sémantiques : vert=ok, ambre=warn, rouge=critique, distincts de l'accent. **N'invente pas de couleurs en dur.**
- Icônes `lucide-react`. Libellés FR en dur OK (i18n extraite ensuite par l'intégrateur).
- **Réutilise les primitives UI existantes** si présentes : `cowork/src/renderer/components/ui/{StatTile,Pill,SectionCard,EmptyState}.tsx` (créées par une vague précédente). Si tu les importes, chemin `../ui/StatTile.js`. Si tu préfères rester autonome, inline.
- Composants = fonctions React nommées `export function XxxView(props: XxxProps)`, PascalCase de fichier ; modules logiques kebab-case dans `os/util/`.
- **Info-design** (ces vues sont scannées, pas lues) : résumé avant détail ; encode l'état dans la FORME (pill/chip/barre de sévérité) pas juste le nombre ; `font-variant-numeric: tabular-nums` pour les colonnes de chiffres ; tables/graphes dans un conteneur `overflow-x-auto`. Pour un graphe, préfère un petit Canvas/SVG à la main (sparkline avec zone remplie + point final accentué) plutôt que d'ajouter une lib.

## Format de chaque tranche
(a) le composant `os/XxxView.tsx` (props-driven, état vide honnête) ; (b) un module logique pur `os/util/xxx-model.ts` (types + fonctions pures : agrégation, tri, formatage) ; (c) un test `tests/xxx-model.test.ts` du module. Chaque vue mappe un vrai sous-système Code Buddy (indiqué) — tu ne l'appelles pas, tu construis la SURFACE qui le rendra.

---

# LES TRANCHES

## Thème A — Flotte multi-IA (Fleet)
### A1 — FleetTopologyView
Carte de la flotte : pairs connectés (nœuds), leur utilisation, latence, rôle. `os/FleetTopologyView.tsx` props `{ peers: Peer[]; onSelect }`. `os/util/fleet-model.ts` : type `Peer` + `summarizeFleet(peers): { online, busy, offline, avgLatency }` + `utilizationTone(u): 'ok'|'warn'|'critical'`. Test.
### A2 — PeerCapabilityMatrix
Matrice pairs × capacités (quels modèles/outils chaque pair expose). `os/PeerCapabilityMatrix.tsx` props `{ peers: Peer[]; capabilities: string[] }`. `os/util/capability-matrix.ts` : `buildMatrix(peers): Cell[][]` + `coverageOf(cap, peers): number`. Test.
### A3 — FleetLoadStrip
Bandeau de charge/saturation de la flotte + backpressure. `os/FleetLoadStrip.tsx` props `{ load: FleetLoad }`. `os/util/fleet-load-model.ts` : `saturationLevel(load): 'idle'|'nominal'|'saturated'` + `formatUtilization`. Test.

## Thème B — Council (mixture-of-agents)
### B1 — CouncilArenaView
Vue d'une délibération : sièges/modèles, verdicts, gagnant, spread de score, citation minoritaire si spread>0.3, DHI. `os/CouncilArenaView.tsx` props `{ session: CouncilSession }`. `os/util/council-model.ts` : type `CouncilSession` + `scoreSpread(verdicts)` + `winnerOf(verdicts)` + `shouldQuoteMinority(spread)` (>0.3). Test.
### B2 — ScoreboardView
Tableau de performance des modèles par catégorie de tâche (le ModelScoreboard). `os/ScoreboardView.tsx` props `{ rows: ScoreRow[]; onSortBy }`. `os/util/scoreboard-model.ts` : `rankByCategory(rows, cat): ScoreRow[]` + `bestForCategory(rows, cat)`. Test.
### B3 — DeliberationHealthChart
Historique du Deliberation Health Index (sparkline SVG). `os/DeliberationHealthChart.tsx` props `{ series: {t:number; dhi:number}[] }`. `os/util/dhi-series.ts` : `movingAverage(series, window)` + `latestTrend(series): 'up'|'down'|'flat'`. Test.

## Thème C — Mémoire collective (CKG)
### C1 — KnowledgeGraphView
Vue du graphe de connaissances : nœuds typés (lesson/decision/fact/discovery), arêtes, corroboration. `os/KnowledgeGraphView.tsx` props `{ nodes: KNode[]; edges: KEdge[]; onSelect }` — layout simple en cercle/force léger sur Canvas OU liste groupée par type (garde simple). `os/util/kg-model.ts` : type `KNode`/`KEdge` + `groupByType(nodes)` + `topCorroborated(nodes, n)`. Test.
### C2 — MemoryRecallInspector
Inspecteur d'une recherche hybride : passages récupérés + scores (BM25/cosinus/salience/MMR). `os/MemoryRecallInspector.tsx` props `{ hits: RecallHit[]; query: string }`. `os/util/recall-model.ts` : `sortByBlendedScore(hits)` + `formatScore`. Test.
### C3 — MemoryTimelineView
Ligne temporelle bi-temporelle des faits (création vs validité, supersede). `os/MemoryTimelineView.tsx` props `{ facts: TemporalFact[] }`. `os/util/temporal-model.ts` : `activeAt(facts, ts)` + `supersedeChains(facts)`. Test.

## Thème D — Autonomie 24/7
### D1 — AutonomyDashboard
Tableau de bord du daemon d'autonomie : état, tick courant, tâches en file, self-improvement cycles. `os/AutonomyDashboard.tsx` props `{ status: AutonomyStatus }`. `os/util/autonomy-model.ts` : type `AutonomyStatus` + `healthOf(status): 'ok'|'idle'|'stuck'` + `formatUptime`. Test.
### D2 — SelfImprovementLedger
Historique des cycles Darwin-Gödel : propositions, gate (kept/rolled-back), gains. `os/SelfImprovementLedger.tsx` props `{ cycles: ImproveCycle[] }`. `os/util/improve-model.ts` : `keptRate(cycles)` + `netGain(cycles)`. Test.
### D3 — HeartbeatMonitor
Moniteur du battement (pacemaker sensoriel + heartbeat scheduler) : beats, treatments déclenchés. `os/HeartbeatMonitor.tsx` props `{ beats: Beat[] }`. `os/util/heartbeat-model.ts` : `beatRate(beats)` + `missedBeats(beats, expectedIntervalMs)`. Test.

## Thème E — Missions & coûts (contrôle opérationnel)
### E1 — MissionControlBoard
Le tableau central : toutes les missions (en cours/en file/finies/échouées), priorité, modèle, coût, durée. `os/MissionControlBoard.tsx` props `{ missions: OsMission[]; onOpen; onCancel }`. `os/util/os-mission-model.ts` : type `OsMission` + `partitionByStatus(missions)` + `totalSpend(missions)`. Test.
### E2 — CostGovernorView
Gouvernance de budget : dépense par mission/jour, cap, projection, alertes. `os/CostGovernorView.tsx` props `{ spend: SpendPoint[]; capUsd: number }`. `os/util/cost-model.ts` : `projectedSpend(spend)` + `capStatus(total, cap): 'ok'|'warn'|'over'` + `formatUsd`. Test.
### E3 — RoutingDecisionView
Explique une décision de routage (coût/latence/vie-privée/capacité) pour une tâche. `os/RoutingDecisionView.tsx` props `{ decision: RoutingDecision }`. `os/util/routing-decision-model.ts` : `privacyFlag(d)` + `explainRoute(d): string[]`. Test.

## Thème F — Perception (système nerveux, robot)
### F1 — SensoryStreamView
Flux des perceptions (audio/vision/screen/vital) avec salience. `os/SensoryStreamView.tsx` props `{ events: Percept[] }`. `os/util/percept-model.ts` : `bySalience(events)` + `countByModality(events)`. Test.
### F2 — OrganStatusGrid
Grille d'état des organes sensoriels (vital/audio/vision/screen/ui) : actif, débit. `os/OrganStatusGrid.tsx` props `{ organs: Organ[] }`. `os/util/organ-model.ts` : `activeOrgans(organs)` + `organTone(o)`. Test.

## Thème G — Enveloppe OS
### G1 — MissionControlShell
Le shell qui compose les vues en un cockpit à onglets/sections (Fleet · Council · Memory · Autonomy · Missions · Perception). `os/MissionControlShell.tsx` props = toutes les données injectées + l'onglet actif + `onTabChange`. **Vue de présentation pure**, état vide honnête (« Démarre `buddy server` pour alimenter le cockpit »). Utilise les primitives UI.
### G2 — OsStatusBar
Barre d'état globale condensée (santé flotte, coût du jour, missions actives, battement) — pensée pour coiffer n'importe quelle vue. `os/OsStatusBar.tsx` props `{ summary: OsSummary }`. `os/util/os-summary-model.ts` : `rollupSummary(...parts): OsSummary`. Test.

## MANIFESTE (dernière tranche, OBLIGATOIRE)
`os/agentic-os-wiring.ts` — data-only (aucun import de composant) : liste chaque vue livrée avec `{ id, title, subsystem, componentFile, logicFile, testFile, needsData }` (1 phrase : quelle donnée live la brancher, quel IPC/store la fournira). C'est la facture pour l'intégrateur.

---

# COMPTE-RENDU FINAL (en français)
Tranches faites (id + fichiers + SHA), tsc (0 hors erreurs env), tests verts, tranches non faites, limites (rendu visuel non validé → Patrice en GUI). Ne pousse rien. La branche `feat/cowork-agentic-os` suffit.
