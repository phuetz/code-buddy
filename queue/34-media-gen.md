# Vague — Galerie de génération image/vidéo (façon Genspark), props-driven

Tu es GPT-5.5 (Codex). Respecte `CODEX-CONVENTIONS.md` (concaténé au-dessus). Worktree `feat/media-gen`.

## But (inspiration Genspark image/video gen)
La surface de génération d'images/vidéos : un composer (prompt + options) + une galerie masonry des résultats (chaque
résultat porte son prompt + modèle + statut). Props-driven, aucun accès store/IPC ; génération déclenchée par callback
(Fable branchera le vrai backend). Gère les états `queued|generating|done|error` avec des placeholders animés.

## Fichiers NEUFS uniquement sous `cowork/src/renderer/components/media-gen/`
1. **MediaGenComposer.tsx** — `{ mode:'image'|'video', prompt:string, aspect?:'1:1'|'16:9'|'9:16', count?:number, busy?:boolean,
   onPrompt?(t), onMode?(m), onAspect?(a), onGenerate?() }` → zone de prompt + sélecteurs (mode, ratio, nombre) + bouton Générer.
2. **MediaGallery.tsx** — `{ items:{ id, type:'image'|'video', status:'queued'|'generating'|'done'|'error', url?:string,
   prompt:string, model?:string, aspect?:string, createdAt:number }[], onSelect?(id), onRetry?(id) }` → grille masonry :
   placeholder squelette animé pour queued/generating, média (img/`<video>` poster) pour done, carte d'erreur + retry pour error ;
   overlay au survol avec le prompt + le modèle. Lightbox simple au clic (callback `onSelect`).
3. **media-model.ts** — PURS : `aspectRatio(a)` → {w,h} pour le viewBox, `statusLabel(status)`, `groupByStatus(items)`,
   `bucketByDay(items, now)`. Testable.
4. `cowork/tests/media-gen/media-model.test.ts` — Vitest no-mocks.

## Conventions
Tokens sémantiques, skeleton animé (`animate-pulse`), icônes lucide, responsive (colonnes masonry via CSS columns ou grid),
a11y (alt = prompt, boutons labellisés). Loopback-only pour les URLs affichées (ne charge rien d'externe côté composant — juste
`<img src={url}>` que Fable fournira). Pas de couleur codée en dur.

## Manifeste (OBLIGATOIRE) `cowork/src/renderer/components/media-gen/media-gen-wiring.ts` (data-only).
## Gate : `cd cowork && npx tsc --noEmit`=0 (hors openai) + `npx vitest run cowork/tests/media-gen/` verts. Ne pousse pas.
Compte-rendu FR : fait + tests + SHA. `feat(cowork): media generation gallery`.
