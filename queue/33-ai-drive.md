# Vague — AI Drive (navigateur d'artefacts générés, façon Genspark), props-driven

Tu es GPT-5.5 (Codex). Respecte `CODEX-CONVENTIONS.md` (concaténé au-dessus). Worktree `feat/ai-drive`.

## But (inspiration Genspark « AI Drive »)
Un navigateur des artefacts générés par l'agent (decks, feuilles, docs, images, vidéos, rapports, apps). Props-driven,
aucun accès store/IPC ; actions par callbacks. Grille de cartes + recherche + filtre par type + tri.

## Fichiers NEUFS uniquement sous `cowork/src/renderer/components/drive/`
1. **AiDrive.tsx** — `{ items:{ id, name, kind:'slide'|'sheet'|'doc'|'image'|'video'|'report'|'app'|'audio', createdAt:number,
   sizeBytes?:number, thumbnailUrl?:string }[], query?:string, kindFilter?:string, sort?:'recent'|'name'|'size',
   onOpen?(id), onDelete?(id), onQuery?(q), onKindFilter?(k), onSort?(s) }` → barre (recherche + chips de type + tri) +
   grille de cartes : icône de type (ou thumbnail si fourni), nom, date relative, taille lisible, menu (ouvrir/supprimer).
   EmptyState « Aucun artefact » propre.
2. **drive-model.ts** — PURS : `filterAndSortItems(items,{query,kind,sort})`, `humanSize(bytes)`, `relativeTime(ts, now)`,
   `kindMeta(kind)` (icône lucide + libellé + teinte). C'est le cœur testable. (Passe `now` en argument — pas de `Date.now()` interne.)
3. `cowork/tests/drive/drive-model.test.ts` — Vitest no-mocks (filtre par query+type, tri par récent/nom/taille, humanSize
   aux bornes Ko/Mo/Go, relativeTime avec un `now` fixe).

## Conventions
Tokens sémantiques, icônes lucide-react, `tabular-nums`, responsive (grille auto-fill), a11y. Pas de couleur codée en dur.

## Manifeste (OBLIGATOIRE) `cowork/src/renderer/components/drive/drive-wiring.ts` (data-only).
## Gate : `cd cowork && npx tsc --noEmit`=0 (hors openai) + `npx vitest run cowork/tests/drive/` verts. Ne pousse pas.
Compte-rendu FR : fait + tests + SHA. `feat(cowork): AI Drive artifact browser`.
