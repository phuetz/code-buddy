# Brief 2 — Modernisation Genspark → Cowork (batch massif, ~40 tranches)

Tu es **GPT-5.5** et tu implémentes une grande vague de composants additifs pour **Cowork** (la GUI Electron de Code Buddy, dossier `cowork/`). Ceci est le **batch 2**, ~10× plus gros que le batch 1 (7 tranches déjà livrées). Objectif : couvrir la majeure partie de la roadmap « OS agentique » en **composants isolés, découplés, testés** — que l'intégrateur (Fable) câblera ensuite en une passe contrôlée.

## Modèle de travail
- Tu travailles dans un **worktree git isolé** que tu crées toi-même depuis `main` :
  ```sh
  cd /home/patrice/code-buddy
  git worktree add -b feat/cowork-genspark-2 ../genspark2-wt main
  cd ../genspark2-wt
  ln -s /home/patrice/code-buddy/cowork/node_modules cowork/node_modules   # si absent
  ```
- **UNE tranche = UN commit atomique.** Tu fais autant de tranches que possible, dans l'ordre, en committant chacune. Un batch partiel est acceptable (chaque tranche est indépendante).
- Après CHAQUE tranche : `cd cowork && npx tsc --noEmit` doit rester à **0 erreur**. Si une tranche casse le typecheck, corrige-la avant de committer.
- **NE PUSH JAMAIS. NE MERGE JAMAIS.** Tu commits sur `feat/cowork-genspark-2`, c'est tout. Fable review + gate + intègre.

## Contraintes DURES (non négociables)
1. **Fichiers NEUFS uniquement**, tous sous `cowork/src/renderer/` (composants dans `components/`, logique dans `components/` ou `utils/`, tests dans `cowork/tests/`).
2. **INTERDIT de toucher les god-files / points de montage** : `App.tsx`, `store/index.ts`, `preload/index.ts`, `main/index.ts`, `NewShell.tsx`, `window-management.ts`, et tout `cowork/src/main/**` ou `cowork/src/preload/**`. **INTERDIT de toucher le noyau `src/`** (hors `cowork/`). Tu ne modifies AUCUN fichier existant — que du neuf. (Exception unique : le manifeste final, voir §Manifeste.)
3. **Découplage total** : chaque composant est **props-driven**, aucune dépendance au store Zustand ni à l'IPC. Les données entrent par props, les actions sortent par callbacks (`onLaunch`, `onSelect`, `onApprove`…). Un composant qui aurait besoin de données live reçoit une prop typée + un état vide honnête.
4. `git add` **explicite fichier par fichier**, jamais `-A`/`.`. Ne touche pas `.codebuddy/*`, `ETUDE-*.md`, `buddy-memory/`, `COWORK-GENSPARK-BRIEF*.md`.
5. Trailer de commit, exactement :
   ```
   Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
   Claude-Session: https://claude.ai/code/session_01Wten2ENavfScZnAfZRCSix
   ```
   Commits Conventional Commits : `feat(cowork): <slice>`.

## Conventions Cowork (respecte-les à la lettre)
- **TypeScript strict**, single quotes, semicolons, 2-space indent. ESM : imports avec extension `.js` même depuis `.ts`/`.tsx`.
- **Style = Tailwind avec les tokens sémantiques existants** (regarde `cowork/src/renderer/components/SciencePanel.tsx`, `ArtifactPanel.tsx`, `MessageCard.tsx` pour le vocabulaire de classes) : `bg-surface`, `text-muted-foreground`, `border-border`, `bg-muted`, `text-foreground`, `bg-primary`, `rounded-lg`, etc. **N'invente pas de couleurs en dur** — réutilise les classes déjà employées dans ces fichiers.
- **i18n** : `react-i18next` (`const { t } = useTranslation();`). Pour aller vite et rester découplé, tu peux utiliser des libellés français en dur dans le JSX de ces composants de démo (l'intégrateur fera l'extraction i18n) — MAIS documente-le. Ne modifie PAS les fichiers `i18n/locales/*.json` (ce sont des points partagés).
- **Icônes** : `lucide-react` (`import { Rocket } from 'lucide-react';`).
- **Markdown** : réutilise le composant `MessageMarkdown` (`cowork/src/renderer/components/MessageMarkdown.tsx`) pour tout rendu markdown, ne réimplémente pas.
- **Composants** : fonctions React nommées, `export function XxxPanel(props: XxxProps)`, PascalCase de fichier pour les composants (`MissionBoard.tsx`), kebab/camel pour les modules logiques (`mission-model.ts`).

## Recette de typecheck (à lancer après chaque tranche)
```sh
cd /home/patrice/genspark2-wt/cowork
npx tsc --noEmit 2>&1 | grep -cE "error TS"   # doit afficher 0
```
Pour les tests : `npx vitest run tests/<ton-test>.test.ts`.

## DÉJÀ FAIT — ne recrée RIEN de ça
- **Sur main** : artefacts riches `report` + `table` (`ArtifactPanel.tsx`, `artifact-detector.ts`, `ReportArtifact.tsx`, `TableArtifact.tsx`, `table-csv.ts`).
- **Batch 1 (`feat/cowork-genspark`)** : `MissionTimeline.tsx`, `VerifiedBadge.tsx`, `ModelContributionStrip.tsx`, `SparkPageView.tsx`, `DeliverableCard.tsx`, `CallForMeForm.tsx`, `deliverables.ts`, `sparkpage.ts`, `use-recipe-launch.ts`.
- **Parkés** : `RecipeGallery.tsx`+`agent-recipes.ts` (recipes), `CreditsMeter.tsx`+`credits.ts` (credits), `AutonomySelector.tsx` (autonomy).
Si tu veux COMPLÉTER un de ces composants, crée un fichier VOISIN distinct (ex. `MissionTimelineControls.tsx`), ne réécris pas l'existant.

---

# LES TRANCHES (fais-en le maximum, 1 commit chacune)

> Pour chaque tranche : (a) le(s) composant(s), (b) le module logique pur si listé, (c) un test Vitest du module logique si listé. Chaque module logique = fonctions pures, zéro effet de bord, faciles à tester. Chaque composant mappe une **vraie** capacité Code Buddy (indiquée) — tu n'appelles pas l'outil, tu construis la SURFACE qui l'invoquera via un callback.

## Thème A — Super-Agent unifié

### A1 — IntentBar (roadmap #1)
- `components/IntentBar.tsx` : un grand champ « dis ce que tu veux », bouton Lancer, chips de suggestions ; props `{ suggestions: string[]; onSubmit: (text: string) => void; busy?: boolean }`.
- `utils/intent-classify.ts` : `classifyIntent(text): { kind: 'build'|'research'|'create'|'analyze'|'automate'|'communicate'|'other'; suggestedTool: string; confidence: number }` (heuristique mots-clés → outil noyau : research→`deep_research`, pdf/paper→`paper_qa`, deck→skill pptx, etc.).
- `tests/intent-classify.test.ts` : ≥6 cas couvrant chaque `kind`.

### A2 — MissionBoard (roadmap #3, missions parallèles)
- `components/MissionBoard.tsx` : grille de cartes de missions en cours (statut, progression, modèle, durée) ; props `{ missions: Mission[]; onOpen; onPause; onResume }`.
- `utils/mission-model.ts` : type `Mission` + `summarizeMissions(missions): { running, queued, done, failed }` + `formatElapsed(ms): string`.
- `tests/mission-model.test.ts`.

### A3 — MissionResumeMenu (roadmap #5, reprendre/brancher)
- `components/MissionResumeMenu.tsx` : liste de checkpoints d'une mission avec « reprendre ici » / « brancher autrement » ; props `{ checkpoints: Checkpoint[]; onResume; onBranch }`. Mappe checkpoint/rewind.
- `utils/checkpoint-model.ts` : type `Checkpoint` + `pickLatestStable(checkpoints): Checkpoint | null`.
- `tests/checkpoint-model.test.ts`.

### A4 — DryRunPreview (roadmap #7)
- `components/DryRunPreview.tsx` : « voici ce que je vais faire + coût estimé » avant exécution — liste d'étapes + coût/temps estimés + Confirmer/Annuler ; props `{ plan: PlanStep[]; estimate: CostEstimate; onConfirm; onCancel }`.
- `utils/dryrun-estimate.ts` : `estimatePlan(steps): CostEstimate` (somme tokens/coût/temps par étape) + `formatCost(usd): string`.
- `tests/dryrun-estimate.test.ts`.

### A5 — GuardrailsBadge (complète l'autonomie)
- `components/GuardrailsBadge.tsx` : affiche la posture d'autonomie active + les garde-fous (write bloqué, shell validé, secret guard) ; props `{ mode: 'plan'|'auto'|'full'; guardrails: string[] }`. Purement présentationnel.

## Thème B — Générateurs de livrables

### B1 — SlideDeckBuilder (roadmap #8, AI Slides)
- `components/SlideDeckBuilder.tsx` : prompt → aperçu de plan de deck (liste de slides titrées) + bouton Générer (skill pptx) ; props `{ outline: SlideOutline[]; onGenerate; onEditOutline }`.
- `utils/slide-outline.ts` : `draftOutline(prompt): SlideOutline[]` (heuristique : titre + 3-5 slides suggérées) + `outlineToSpeakerNotes`.
- `tests/slide-outline.test.ts`.

### B2 — SheetAnalystView (roadmap #9, AI Sheets analyste)
- `components/SheetAnalystView.tsx` : décrit une table vivante à remplir depuis le web (colonnes + source) et un aperçu ; props `{ schema: SheetSchema; rows: string[][]; onRun }`. Mappe deep-research + skill xlsx.
- `utils/sheet-schema.ts` : type `SheetSchema` + `parseSheetRequest(prompt): SheetSchema` (« top 20 vidéos IA avec vues, likes, durée » → colonnes) + `rowsToCsv`.
- `tests/sheet-schema.test.ts`.

### B3 — DocComposer (roadmap #10, AI Docs)
- `components/DocComposer.tsx` : plan de document long + sections + bouton Générer (skill docx) ; props `{ sections: DocSection[]; onGenerate }`.
- `utils/doc-outline.ts` : `draftDocOutline(prompt): DocSection[]` + `estimateReadingTime(sections): number`.
- `tests/doc-outline.test.ts`.

### B4 — ImagePromptStudio (roadmap #12)
- `components/ImagePromptStudio.tsx` : composer de prompt image (style, ratio, presets) + grille de résultats (placeholders) ; props `{ presets: ImagePreset[]; results: ImageResult[]; onGenerate }`.
- `utils/image-preset.ts` : catalogue de presets + `buildImagePrompt(base, preset): string`.
- `tests/image-preset.test.ts`.

### B5 — ShortVideoStoryboard (roadmap #13)
- `components/ShortVideoStoryboard.tsx` : storyboard texte→short (scènes, durée, voix) ; props `{ scenes: Scene[]; onRender }`.
- `utils/storyboard-model.ts` : `draftStoryboard(text): Scene[]` + `totalDuration(scenes): number`.
- `tests/storyboard-model.test.ts`.

### B6 — PodcastComposer (roadmap #14, AI Pods)
- `components/PodcastComposer.tsx` : recherche/contenu → script narré (segments, voix Piper) + bouton Synthétiser ; props `{ segments: PodSegment[]; onSynthesize }`. Mappe TTS Piper.
- `utils/podcast-script.ts` : `draftPodcastScript(topic): PodSegment[]` + `estimateAudioLength(segments): number`.
- `tests/podcast-script.test.ts`.

### B7 — ExportShareSheet (roadmap #15)
- `components/ExportShareSheet.tsx` : exporter/partager un livrable (PDF, MD, lien, push canal) ; props `{ deliverable: DeliverableRef; formats: ExportFormat[]; onExport; onShare }`.
- `utils/export-format.ts` : catalogue de formats + `filenameFor(deliverable, format): string` + `mimeFor(format): string`.
- `tests/export-format.test.ts`.

## Thème C — Actions dans le monde réel

### C1 — BrowserAutopilotPanel (roadmap #19)
- `components/BrowserAutopilotPanel.tsx` : plan de navigation multi-étapes + captures de preuve + statut par étape ; props `{ steps: NavStep[]; onStart; onStop }`. Mappe BrowserOperator/web_test.
- `utils/autopilot-plan.ts` : type `NavStep` + `planFromGoal(goal): NavStep[]` + `progressOf(steps): number`.
- `tests/autopilot-plan.test.ts`.

### C2 — ComputerUseViewer (roadmap #20)
- `components/ComputerUseViewer.tsx` : aperçu écran + arbre de fichiers locaux vus par l'agent ; props `{ screenshot?: string; files: FileNode[]; onPick }`. Mappe ComputerUse/OmniParser.
- `utils/perception-model.ts` : type `FileNode` + `flattenTree` + `countByExt`.
- `tests/perception-model.test.ts`.

### C3 — CallLogView (complète #17 Call-for-me)
- `components/CallLogView.tsx` : transcript + résumé d'un appel rendu par l'agent téléphonique ; props `{ transcript: CallTurn[]; summary: string }`.
- `utils/call-model.ts` : type `CallTurn` + `summarizeCall(turns): { durationSec, speakerCount }`.
- `tests/call-model.test.ts`.

## Thème D — « Claw » : employé IA par messagerie

### D1 — ChannelMissionAssign (roadmap #22)
- `components/ChannelMissionAssign.tsx` : assigner une mission depuis un canal (WhatsApp/Telegram/Slack/Teams) + choix du canal + posture ; props `{ channels: ChannelRef[]; onAssign }`.
- `utils/channel-mission.ts` : type `ChannelRef` + `validateAssignment(input): { ok: boolean; error?: string }`.
- `tests/channel-mission.test.ts`.

### D2 — WorkerDashboard (roadmap #23)
- `components/WorkerDashboard.tsx` : dashboard « mon employé IA 24/7 » (uptime, missions traitées, saturation) ; props `{ status: WorkerStatus }`.
- `utils/worker-status.ts` : type `WorkerStatus` + `healthLabel(status): 'ok'|'busy'|'down'` + `formatUptime(sec): string`.
- `tests/worker-status.test.ts`.

### D3 — RemoteApprovalCard (roadmap #25)
- `components/RemoteApprovalCard.tsx` : demande d'approbation human-in-the-loop (action, risque, diff résumé) + Approuver/Refuser ; props `{ request: ApprovalRequest; onApprove; onReject }`.
- `utils/approval-model.ts` : type `ApprovalRequest` + `riskLevel(request): 'low'|'medium'|'high'`.
- `tests/approval-model.test.ts`.

### D4 — MobileSupervisionView (roadmap #24)
- `components/MobileSupervisionView.tsx` : vue compacte « mobile » de suivi des missions (liste condensée + actions valider/stopper) ; props `{ missions: Mission[]; onAct }`. Réutilise le type `Mission` de A2.

## Thème E — AI Drive & artefacts

### E1 — DriveGrid (roadmap #26)
- `components/DriveGrid.tsx` : espace unifié versionné des livrables (grille + recherche + tags + type) ; props `{ items: DriveItem[]; onOpen; onTag }`.
- `utils/drive-index.ts` : type `DriveItem` + `filterDrive(items, query, tags): DriveItem[]` + `groupByType`.
- `tests/drive-index.test.ts`.

### E2 — DeliverableVersionTimeline (roadmap #27)
- `components/DeliverableVersionTimeline.tsx` : historique de versions d'un livrable + diff résumé ; props `{ versions: DeliverableVersion[]; onRestore; onDiff }`.
- `utils/version-model.ts` : type `DeliverableVersion` + `diffSummary(a, b): { added, removed, changed }`.
- `tests/version-model.test.ts`.

### E3 — ShareLinkDialog (roadmap #28)
- `components/ShareLinkDialog.tsx` : partage d'un livrable (lien, permissions lecture/écriture, expiration) ; props `{ item: DriveItem; onCreateLink }`. Modale accessible (`role="dialog"`, `aria-modal`, focus-trap, Escape).
- `utils/share-perms.ts` : `buildShareLink(id, perms): string` + `validatePerms`.
- `tests/share-perms.test.ts`.

## Thème F — Mixture-of-Agents

### F1 — ModelComparatorView (roadmap #31)
- `components/ModelComparatorView.tsx` : réponses de N modèles côte à côte + votes/scores ; props `{ answers: ModelAnswer[]; onPick }`.
- `utils/comparator-model.ts` : type `ModelAnswer` + `rankAnswers(answers): ModelAnswer[]` (par score) + `agreementRate`.
- `tests/comparator-model.test.ts`.

### F2 — DeliberationPanel (roadmap #32)
- `components/DeliberationPanel.tsx` : panneau de débat du council (verdicts, citation minoritaire verbatim si spread>0.3, DHI) ; props `{ verdicts: Verdict[]; dhi: number; minorityQuote?: string }`.
- `utils/deliberation-model.ts` : type `Verdict` + `scoreSpread(verdicts): number` + `shouldQuoteMinority(spread): boolean` (>0.3).
- `tests/deliberation-model.test.ts`.

### F3 — RoutingVizStrip (roadmap #33)
- `components/RoutingVizStrip.tsx` : bandeau visualisant le routage coût/latence/vie-privée d'une tâche ; props `{ route: RouteDecision }`. Mappe privacy-lint/task-router.
- `utils/routing-model.ts` : type `RouteDecision` + `privacyFlag(route): 'ok'|'warn'` + `formatLatency(ms)`.
- `tests/routing-model.test.ts`.

## Thème G — Modernisation UX transversale

### G1 — OneScreenOnboarding (roadmap #34)
- `components/OneScreenOnboarding.tsx` : onboarding « 1 écran » — détecte le chemin ($0 Ollama / login OAuth), 1 action évidente ; props `{ detected: 'ollama'|'login'|'none'; onChoose }`.
- `utils/onboarding-steps.ts` : `recommendPath(env): { primary: string; secondary: string }`.
- `tests/onboarding-steps.test.ts`.

### G2 — SkillMarketplaceGallery (roadmap #36)
- `components/SkillMarketplaceGallery.tsx` : vitrine de skills importables (Hermes/OpenClaw) 1-clic + recherche + catégories ; props `{ skills: SkillCard[]; onImport }`.
- `utils/marketplace-catalog.ts` : type `SkillCard` + `filterSkills(skills, query, category)` + `groupByCategory`.
- `tests/marketplace-catalog.test.ts`.

### G3 — OutputTemplatePicker (roadmap #41)
- `components/OutputTemplatePicker.tsx` : choisir le type de sortie AVANT lancement (rapport / deck / tableau / page / podcast) ; props `{ templates: OutputTemplate[]; onPick }`.
- `utils/output-templates.ts` : catalogue `OutputTemplate[]` (id, label, icon, mapped-tool) + `templateById`.
- `tests/output-templates.test.ts`.

### G4 — MissionReplayView (roadmap #40)
- `components/MissionReplayView.tsx` : rejouer un run (timeline d'événements rejouable, play/pause/étape) ; props `{ events: RunEvent[]; onSeek }`.
- `utils/replay-model.ts` : type `RunEvent` + `buildTimeline(events): TimelineMark[]` + `eventAt(events, ms)`.
- `tests/replay-model.test.ts`.

### G5 — MissionCompleteToast (roadmap #39)
- `components/MissionCompleteToast.tsx` : toast de fin de mission + résumé cliquable ; props `{ summary: MissionSummary; onOpen; onDismiss }`. Respecte `prefers-reduced-motion`.
- `utils/toast-model.ts` : type `MissionSummary` + `formatSummary(summary): string`.

### G6 — FocusRunnerView (roadmap #38)
- `components/FocusRunnerView.tsx` : runner de mission plein écran (mode focus : 1 mission, gros statut, log live) ; props `{ mission: Mission; log: string[]; onExit }`. Réutilise `Mission` de A2.

## Thème H — Bibliothèque de primitives (visual pass, roadmap #42)
Composants réutilisables partagés (les autres tranches peuvent les importer si tu les fais en premier — sinon inline) :
### H1 — UI primitives
- `components/ui/StatTile.tsx` : `{ label, value, hint?, tone? }` — tuile de stat (télémétrie).
- `components/ui/Pill.tsx` : `{ children, tone?: 'default'|'success'|'warning'|'danger'|'info' }`.
- `components/ui/SectionCard.tsx` : carte à en-tête + slot d'actions.
- `components/ui/EmptyState.tsx` : `{ icon, title, hint, action? }` — état vide honnête réutilisable.
- `utils/ui-tone.ts` : `toneClasses(tone): string` (mappe tone → classes Tailwind sémantiques) + test `tests/ui-tone.test.ts`.

---

# MANIFESTE D'INTÉGRATION (dernière tranche, OBLIGATOIRE)

Après avoir fait les tranches, crée **un seul** fichier neuf :
`components/genspark-slices.ts` — un registre TypeScript qui **liste** tout ce que tu as créé, pour que l'intégrateur câble en une passe :
```ts
export interface GensparkSlice {
  id: string;                 // 'A1', 'B2'…
  title: string;              // libellé humain
  roadmap: number;            // n° roadmap
  category: 'agent'|'deliverable'|'action'|'claw'|'drive'|'moa'|'ux'|'ui';
  mount: 'labs'|'composer'|'chat-inline'|'settings'|'panel'|'primitive';
  componentFile: string;      // chemin relatif du .tsx
  logicFile?: string;         // module logique si présent
  testFile?: string;
  needsData: string;          // 1 phrase : quelle donnée live/prop il faut lui brancher
}
export const GENSPARK_SLICES: GensparkSlice[] = [ /* une entrée par tranche livrée */ ];
```
Ce fichier ne fait qu'exporter des données (aucun import de composant → pas de couplage), donc il typecheck seul. Il est ta « facture » : l'intégrateur sait exactement quoi monter et où.

---

# COMPTE-RENDU FINAL (à la fin, en français)
Rends : la liste des tranches faites (id + fichiers + commit SHA), le résultat tsc (0), le nombre de tests verts, les tranches que tu n'as pas eu le temps de faire, et toute limite honnête. Ne pousse rien. La branche `feat/cowork-genspark-2` + tes commits suffisent.
