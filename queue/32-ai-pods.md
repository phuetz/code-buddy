# Vague — AI Pods (lecteur podcast façon Genspark), props-driven

Tu es GPT-5.5 (Codex). Respecte `CODEX-CONVENTIONS.md` (concaténé au-dessus). Worktree `feat/ai-pods`.

## But (inspiration Genspark « AI Pods »)
Un lecteur de podcast généré : audio + transcript synchronisé + chapitres + intervenants. **Props-driven**, aucun accès
store/IPC (le vrai TTS/audio sera branché par Fable via `<audio>` + un callback de temps).

## Fichiers NEUFS uniquement sous `cowork/src/renderer/components/pods/`
1. **PodPlayer.tsx** — `{ title, coverUrl?, durationSec, playing?, currentTime?, chapters:{ts:number,title:string}[],
   speakers:{id:string,name:string,color?}[], transcript:{speaker:string,ts:number,text:string}[],
   onTogglePlay?(), onSeek?(sec:number), onSpeed?(x:number) }` → pochette + contrôles (play/pause, ±15s, vitesse),
   barre de progression cliquable avec **marqueurs de chapitres**, liste de chapitres cliquables, et un **transcript qui
   surligne la ligne courante** (selon `currentTime`) avec puces de couleur par intervenant. Auto-scroll doux vers la ligne active.
2. **pod-model.ts** — PURS : `activeChapter(chapters, t)`, `activeTranscriptIndex(transcript, t)`, `formatTime(sec)`,
   `groupBySpeaker(transcript)`. C'est le cœur testable.
3. `cowork/tests/pods/pod-model.test.ts` — Vitest no-mocks des fonctions pures (bornes, ts exactement sur une frontière, t avant le 1er).

## Conventions
Tokens sémantiques (`bg-surface`, `text-foreground`, `text-muted-foreground`, `bg-primary` pour la progression jouée),
`tabular-nums` pour les temps, a11y (slider `role="slider"`+aria, boutons labellisés), responsive, EmptyState.

## Manifeste (OBLIGATOIRE) `cowork/src/renderer/components/pods/pods-wiring.ts` (data-only).
## Gate : `cd cowork && npx tsc --noEmit`=0 (hors openai) + `npx vitest run cowork/tests/pods/` verts. Ne pousse pas.
Compte-rendu FR : ce qui est fait + tests + SHA. `feat(cowork): AI Pods player`.
