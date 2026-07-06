# Vague — Bibliothèque de data-viz props-driven (SVG à la main, zéro lib)

Tu es GPT-5.5 (Codex). Respecte `CODEX-CONVENTIONS.md` (déjà concaténé au-dessus). Worktree `feat/viz-components`.

## But
Crée une petite bibliothèque de graphiques **props-driven** (données par props, zéro accès store/IPC), en **SVG dessiné
à la main** (PAS de lib : ni recharts, ni d3, ni chart.js). Réutilisable partout dans Cowork.

## Fichiers NEUFS uniquement sous `cowork/src/renderer/components/viz/`
Pour CHAQUE composant : (a) le `.tsx` props-driven ; (b) un module logique pur `*-scale.ts` (types + fonctions pures :
min/max/normalisation/ticks) ; (c) un test Vitest `cowork/tests/viz/*.test.ts` du module pur (no-mocks).
1. **Sparkline.tsx** — `{ values:number[], width?, height?, stroke? }` → mini courbe SVG (path), pas d'axes.
2. **BarChart.tsx** — `{ data:{label:string,value:number}[], height? }` → barres verticales + labels + valeurs (`tabular-nums`).
3. **Donut.tsx** — `{ slices:{label,value,color?}[] }` → anneau SVG (arcs) + légende ; couleurs par défaut d'une palette.
4. **Heatmap.tsx** — `{ matrix:number[][], rows?, cols? }` → grille de cellules colorées par intensité (échelle de gris→accent).
5. **Timeline.tsx** — `{ events:{ts:number,label:string,status?:'done'|'running'|'error'}[] }` → frise horizontale.

## Conventions
Tokens Tailwind sémantiques (`text-foreground`, `text-muted-foreground`, `stroke-*` via `currentColor`/tokens accent),
`tabular-nums` pour les chiffres, conteneur large en `overflow-x-auto`. EmptyState propre si data vide. a11y : `role="img"`
+ `aria-label`. Responsive (viewBox + width 100%).

## Manifeste (OBLIGATOIRE, dernier fichier) `cowork/src/renderer/components/viz/viz-wiring.ts` (data-only) :
liste `{ id, title, componentFile, logicFile, testFile, props }` de chaque composant.

## Gate : `cd cowork && npx tsc --noEmit`=0 (hors openai) + `npx vitest run cowork/tests/viz/` verts. Ne pousse pas.
Compte-rendu FR : composants + tests (X passed) + SHA. `test/style/feat(cowork): viz <composant>`.
