# Vague — Câbler les nouvelles surfaces Genspark dans la galerie Labs

Tu es GPT-5.5 (Codex). Respecte `CODEX-CONVENTIONS.md` (concaténé au-dessus). Worktree `feat/labs-wiring`.

## But
Rendre visibles dans la **galerie Labs** tous les composants Genspark construits récemment (déjà sur main), avec des
**données de démo réalistes** (pas juste vides — ils doivent avoir l'air VIVANTS). Tu ajoutes des entrées dans deux
fichiers registres existants. C'est mécanique : lis chaque composant pour ses props EXACTES + ses sous-types, puis écris
l'entrée correspondante.

## Comment Labs marche (étudie-le d'abord)
- `cowork/src/renderer/components/genspark-slices.ts` : `GENSPARK_SLICES: GensparkSlice[]` (data-only : `{ id, title,
  roadmap, category, mount, componentFile, logicFile?, testFile?, needsData }`). Catégories : agent|deliverable|action|
  claw|drive|moa|ux|ui. `mount:'labs'` pour apparaître dans la galerie.
- `cowork/src/renderer/components/labs/labs-catalog.ts` : `const WIRING: Record<string, LabsWiring>` où chaque entrée =
  `{ load: () => import('../<path>').then((m) => named(m, '<ExportName>')), props: { <données de démo> } }`. `LABS_ENTRIES`
  filtre les slices `mount:'labs'|'panel'` qui ont un `WIRING[id]`. Copie EXACTEMENT le motif des entrées existantes (A2, B1…).

## Composants à câbler (tous sur main, lis leurs props EXACTES avant d'écrire les données)
Assigne des id neufs non utilisés (ex. `NV1..NV7`, `ND1..ND3`, `NA1..NA4`, `NM1..NM2`, `NG1`). Pour CHACUN, une entrée
`GENSPARK_SLICES` + une entrée `WIRING` avec **des props de démo qui typecheckent** (respecte les vrais types/sous-types) :
- **viz/** (category `ui`) : `Sparkline` (values:number[]), `BarChart` (data), `Donut` (segments), `Heatmap` (rows/cols/cells),
  `TimelineChart` (events), `StackedBar` (parts), `GaugeMeter` (value/max). Données de démo parlantes (courbes croissantes, etc.).
- **deliverables/** (category `deliverable`) : `SlideDeckPreview` (slides[] : ~3 slides titre+puces), `SheetPreview`
  (columns+rows : ~4 colonnes × 5 lignes), `DocPreview` (blocks[] : h1+p+list).
- **drive/AiDrive** (category `drive`) : ~6 artefacts de démo variés (deck/sheet/doc/image/report) avec dates/tailles.
- **media-gen/** (category `deliverable`) : `MediaGallery` (~6 items mixant statuts done/generating/queued), `MediaGenComposer`
  (mode:'image', prompt court).
- **os-panels/** (category `agent`) : `AutonomyDashboard` (posture+chiffres réalistes), `KnowledgeGraphView` (~5 nodes + edges),
  `OsStatusBar` (~4 items de statut), `MissionControlShell` (header/left/main/right — mets des `null` ou de petits placeholders).
- **template-gallery/TemplateGallery** (category `ui`) : props `{}` (il a des défauts `DEFAULT_TEMPLATES`).

## Contraintes
- Modifie UNIQUEMENT `genspark-slices.ts` + `labs/labs-catalog.ts` (+ lis les composants). N'ajoute pas de composant.
  Ne touche pas `LabsGallery.tsx` (il consomme le registre automatiquement).
- `git add` explicite. NE PUSH PAS. Un commit, trailer :
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Wten2ENavfScZnAfZRCSix
  ```
  `feat(cowork): surface new Genspark components in the Labs gallery`.
- Gate : `cd cowork && npx tsc --noEmit`=0 (hors openai) + `npx vite build` exit 0. `git status` propre.

## Compte-rendu FR : composants câblés (nb), catégories, tsc/vite, SHA. Ne pousse pas — Fable gate + valide au screenshot.
