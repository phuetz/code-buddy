# Vague — Migration des couleurs codées en dur vers les tokens de thème

Tu es GPT-5.5 (Codex). Tu remplaces les couleurs Tailwind **codées en dur** (zinc/gray/slate/neutral)
par les **tokens sémantiques du thème** dans les composants renderer de Cowork, pour qu'ils s'affichent
correctement dans TOUS les thèmes (sombres ET clairs Anthropic/Light). Worktree isolé `feat/color-tokens-sweep`
— ne change pas de branche.

## Pourquoi
62 fichiers codent des couleurs `zinc-*/gray-*` en présumant le thème sombre. Sur les thèmes CLAIRS, elles
cassent (texte gris pâle illisible, fonds sombres sur clair). Les tokens (`text-muted-foreground`, `bg-surface`…)
s'adaptent au thème. Objectif : lisibilité dans tous les thèmes.

## Mapping EXACT à appliquer (mécanique, remplacement de classe)
Remplace UNIQUEMENT ces classes exactes (dans `className="..."` et les template strings) :
- `text-zinc-400`, `text-zinc-500`, `text-zinc-600`, `text-gray-400`, `text-gray-500`, `text-gray-600`,
  `text-slate-400`, `text-slate-500`, `text-neutral-400`, `text-neutral-500` → **`text-muted-foreground`**
- `text-zinc-200`, `text-zinc-300`, `text-gray-200`, `text-gray-300`, `text-slate-300` → **`text-secondary`**
- `text-zinc-100`, `text-gray-100`, `text-zinc-50` → **`text-foreground`**
- `bg-zinc-900`, `bg-gray-900`, `bg-slate-900`, `bg-neutral-900` → **`bg-background`**
- `bg-zinc-800`, `bg-gray-800`, `bg-slate-800`, `bg-neutral-800` → **`bg-surface`**
- `bg-zinc-700`, `bg-gray-700` → **`bg-surface-hover`**
- `border-zinc-700`, `border-zinc-800`, `border-gray-700`, `border-gray-800`, `border-slate-700`,
  `border-neutral-800` → **`border-border`**
- `border-zinc-600`, `border-gray-600` → **`border-border-muted`**

## NE TOUCHE PAS (laisse tel quel — ce sont des choix intentionnels ou hors périmètre)
1. **Toute classe avec une opacité `/NN`** (ex. `bg-zinc-800/30`, `border-zinc-700/50`, `text-zinc-500/70`) —
   les tokens ne supportent pas encore l'alpha ; les migrer casserait le rendu. **Skip toutes les variantes `/`.**
2. **`bg-white`, `bg-black`, `text-white`, `text-black`** — souvent intentionnels (texte blanc sur bouton coloré,
   overlays). Ne les touche pas.
3. **Couleurs de STATUT** : `green`/`emerald`/`red`/`rose`/`amber`/`yellow`/`orange`/`blue`/`sky`/`purple`/`violet`
   (success/error/warning/info/tools) — intentionnelles, garde-les.
4. **Les swatches / previews de design system** (`DesignSystemGallery.tsx`, `StudioComposer.tsx` le bloc swatch) —
   ce sont de VRAIES couleurs de marque en `style={{backgroundColor}}`, pas des classes ; n'y touche pas.
5. Fichiers hors renderer, tests, `.css`.

## Périmètre
- UNIQUEMENT sous `cowork/src/renderer/components/**/*.tsx`. Fais le maximum de fichiers (il y en a ~62).
- Commits par LOTS thématiques (ex. « message components », « settings », « os panels ») — pas un seul commit géant,
  pour que Fable puisse gater par lot.

## Méthode sûre
Pour chaque fichier : lis-le, remplace SEULEMENT les classes exactes du mapping (jamais une sous-chaîne d'autre chose),
saute tout ce qui a `/opacité` ou est dans la liste NE TOUCHE PAS. Après chaque lot, `cd cowork && npx tsc --noEmit`
(ignore `Cannot find module 'openai'`). Un remplacement de classe ne change jamais la logique TS → tsc doit rester à 0.

## Contraintes
- TS strict, `git add` explicite fichier par fichier. NE PUSH PAS, NE MERGE PAS. Commits atomiques par lot, trailer :
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Wten2ENavfScZnAfZRCSix
  ```
  Messages : `style(cowork): theme tokens for <lot>`.
- Gate final : `cd cowork && npx tsc --noEmit` = 0 (hors openai) + `npx vite build` exit 0. `git status` propre.

## Compte-rendu (français) : lots faits + nb de fichiers/remplacements par lot, ce que tu as sauté (opacité/statut/blanc),
tsc/vite, SHA(s). Ne pousse pas — Fable gate + valide au screenshot sur thème clair.
