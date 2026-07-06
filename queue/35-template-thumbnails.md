# Vague — Galerie de vignettes de templates (façon Genspark : « voir ce qui va être créé »)

Tu es GPT-5.5 (Codex). Respecte `CODEX-CONVENTIONS.md` (concaténé au-dessus). Worktree `feat/template-thumbnails`.

## But (inspiration Genspark)
Avant de générer, Genspark montre des **vignettes** qui préfigurent le RÉSULTAT (une mini-maquette du type de livrable).
Crée une galerie de cartes où chaque carte affiche une **mini-maquette dessinée à la main (SVG/CSS, ZÉRO image, zéro lib)**
du type de sortie, + son nom + une phrase. Props-driven, aucun accès store/IPC ; sélection par callback.

## Fichiers NEUFS uniquement sous `cowork/src/renderer/components/template-gallery/`
1. **TemplateThumbnail.tsx** — `{ kind: 'web-app'|'landing'|'dashboard'|'slide-deck'|'sheet'|'doc'|'report'|'api'|'mobile'|'image',
   accent?:string }` → une **maquette wireframe SVG/CSS** distincte par `kind` :
   - web-app : fenêtre de navigateur (barre + sidebar + contenu) ; landing : hero + 3 sections ; dashboard : grille de
     cartes-graphes (barres/donut stylisés) ; slide-deck : slide (titre + puces) avec pagination ; sheet : grille de tableau ;
     doc : lignes de texte + titre ; report : colonnes façon magazine ; api : liste de endpoints (méthodes colorées) ;
     mobile : cadre de téléphone ; image : cadre avec icône média.
   Les maquettes sont **schématiques et élégantes** (rectangles arrondis, tokens de thème, l'`accent` colore l'élément clé).
2. **TemplateGallery.tsx** — `{ items:{ id:string, kind:<le type ci-dessus>, name:string, tagline:string, accent?:string }[],
   selectedId?:string, onSelect?(id) }` → grille responsive de cartes = `<TemplateThumbnail>` + nom + tagline ;
   la carte sélectionnée est mise en évidence (bord accent). Recherche facultative en tête.
3. **template-kinds.ts** — PUR : le type `TemplateKind`, une liste par défaut `DEFAULT_TEMPLATES` (id/kind/name/tagline),
   et un `filterTemplates(items, query)`. Testable.
4. `cowork/tests/template-gallery/template-kinds.test.ts` — Vitest no-mocks (filtre, défauts non vides, chaque kind unique).

## Conventions
Tokens sémantiques (`bg-surface`, `bg-background`, `border-border`, `text-foreground`, `text-muted-foreground`), l'accent via
`var(--color-accent)` ou une prop. a11y (`role="img"`+aria-label par vignette, boutons de carte labellisés). Responsive
(SVG `viewBox`, `width:100%`). Soigne le rendu — c'est une surface vitrine.

## Manifeste (OBLIGATOIRE) `cowork/src/renderer/components/template-gallery/template-gallery-wiring.ts` (data-only).
## Gate : `cd cowork && npx tsc --noEmit`=0 (hors openai) + `npx vitest run cowork/tests/template-gallery/` verts. Ne pousse pas.
Compte-rendu FR : les kinds rendus + tests + SHA. `feat(cowork): template thumbnail gallery`.
