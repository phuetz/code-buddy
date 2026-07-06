# Vague — Aperçus de livrables (deck / feuille / doc), props-driven

Tu es GPT-5.5 (Codex). Respecte `CODEX-CONVENTIONS.md` (concaténé au-dessus). Worktree `feat/deliverable-previews`.

## But
Composants d'**aperçu** props-driven pour les livrables générés (façon Genspark) : un deck de slides, une feuille
tabulaire, un document. **AUCUN accès store/IPC** ; render pur depuis des props. Fable les branchera sur les vrais
générateurs (pptx/xlsx/docx) plus tard.

## Fichiers NEUFS uniquement sous `cowork/src/renderer/components/deliverables/`
Pour chacun : (a) le `.tsx` ; (b) module logique pur `*-model.ts` (types + fonctions pures) ; (c) test Vitest
`cowork/tests/deliverables/*.test.ts` (no-mocks).
1. **SlideDeckPreview.tsx** — `{ slides:{title?:string, bullets?:string[], notes?:string}[], activeIndex?, onSelect?(i) }`
   → vignettes de slides + panneau de la slide active (titre + puces). Navigation prev/next.
2. **SheetPreview.tsx** — `{ columns:string[], rows:(string|number)[][], caption? }` → table lisible (`overflow-x-auto`,
   `tabular-nums`, en-têtes sticky), tronque proprement au-delà de N lignes avec un compteur « +N lignes ».
3. **DocPreview.tsx** — `{ blocks:{type:'h1'|'h2'|'p'|'quote'|'code'|'list', text?:string, items?:string[]}[] }`
   → rendu document typographié (Source Serif pour le corps si dispo, sinon défaut), largeur de lecture confortable.

## Conventions
Tokens sémantiques, pas de couleur codée en dur. a11y (roles/aria). Responsive. EmptyState propre.

## Manifeste (OBLIGATOIRE) `cowork/src/renderer/components/deliverables/deliverables-wiring.ts` (data-only).

## Gate : `cd cowork && npx tsc --noEmit`=0 (hors openai) + `npx vitest run cowork/tests/deliverables/` verts. Ne pousse pas.
Compte-rendu FR : composants + tests + SHA. `feat(cowork): deliverable <composant>`.
