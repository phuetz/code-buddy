# Vague — App Studio « itérer » (chatter pour modifier + tester), façon bolt.new

Tu es GPT-5.5 (Codex). Respecte `CODEX-CONVENTIONS.md` (concaténé au-dessus). Worktree `feat/studio-iterate`.

## But (inspiration bolt.new)
Après avoir généré une app dans App Studio, bolt.new permet de : (1) **chatter pour demander des modifications**
(« rends le bouton bleu », « ajoute un filtre ») → l'agent édite les fichiers, la preview se met à jour ; (2) **tester**
le résultat (preview + rechargement + tailles d'écran). Construis les composants **props-driven** de cette expérience.
Fable les branchera sur la vraie session d'agent scoppée au projet (les modifs = messages de suivi) et le vrai dev server.

## Fichiers NEUFS uniquement sous `cowork/src/renderer/components/studio-iterate/`
Pour chaque composant : (a) le `.tsx` props-driven ; (b) un module logique pur `*-model.ts` si utile (types + fonctions
pures) ; (c) un test Vitest `cowork/tests/studio-iterate/*.test.ts` (no-mocks) pour la logique pure.
1. **StudioChatPanel.tsx** — le chat d'itération. `{ messages: { id:string, role:'user'|'assistant', text:string,
   streaming?:boolean }[], busy?:boolean, suggestions?:string[], onSend?(text:string), onStop?() }` → liste de bulles
   (user/assistant, l'assistant en cours affiche un curseur/skeleton), + un composer en bas (textarea + Envoyer, Ctrl/⌘+Entrée,
   désactivé si busy avec un bouton Stop), + des puces de suggestions cliquables (« Change le thème », « Ajoute des tests »…).
   Auto-scroll vers le bas à chaque nouveau message.
2. **ChangedFilesStrip.tsx** — ce que le dernier tour a modifié (façon bolt.new). `{ changes: { path:string,
   kind:'added'|'modified'|'deleted' }[], onOpen?(path:string) }` → liste compacte : icône+couleur par kind (vert/ambre/rouge),
   chemin cliquable, compteur « +N -M ». EmptyState discret si rien.
3. **PreviewToolbar.tsx** — barre de test de la preview. `{ url?:string, status:'idle'|'starting'|'running'|'dead',
   device:'desktop'|'tablet'|'mobile', onReload?(), onDevice?(d), onOpenExternal?(), onToggle?() }` → bouton lancer/arrêter
   selon status, sélecteur d'appareil (3 tailles), rechargement, ouvrir en externe, + un libellé d'URL/statut (pastille de couleur).
4. **iterate-model.ts** — PURS : `summarizeChanges(changes)` → `{ added, modified, deleted }`, `deviceWidth(device)` →
   largeur px pour le cadre de preview, `lastAssistantMessage(messages)`. Testable.

## Conventions
Tokens sémantiques (`bg-surface`, `bg-background`, `text-foreground`, `text-muted-foreground`, `border-border`,
`bg-primary` ; statuts vert/ambre/rouge distincts de l'accent). Icônes lucide-react. `tabular-nums`. a11y (roles/aria,
boutons labellisés, le chat en `role="log"` `aria-live="polite"`). Responsive, `min-h-0`/`overflow-y-auto` pour le scroll.
Loopback-only pour l'URL de preview (juste affichée/ouverte, pas de fetch dans le composant).

## Manifeste (OBLIGATOIRE) `cowork/src/renderer/components/studio-iterate/studio-iterate-wiring.ts` (data-only) :
`{ id, title, componentFile, logicFile?, testFile?, mount:'labs', needsData }` par composant (mets `mount:'labs'` pour la
découvrabilité, Fable les montera dans App Studio ensuite).

## Gate : `cd cowork && npx tsc --noEmit`=0 (hors openai) + `npx vitest run cowork/tests/studio-iterate/` verts +
`npx vite build` exit 0. `git add` explicite, commits atomiques par composant. NE PUSH PAS. Trailer :
```
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Wten2ENavfScZnAfZRCSix
```
`feat(cowork): App Studio iterate <composant>`. Compte-rendu FR : composants + tests + SHA. Ne pousse pas — Fable gate + câble sur la vraie session d'agent.
