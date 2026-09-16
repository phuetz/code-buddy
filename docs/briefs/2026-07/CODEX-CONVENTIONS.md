# Conventions Codex — règles communes à toutes les vagues (référencées par chaque brief)

Tu es **GPT-5.5 (Codex)**, tu produis une vague de travail additif pour **Code Buddy**. Ton brief spécifique liste les tranches ; CE fichier donne les règles communes. **Respecte-les à la lettre.**

## Worktree (déjà créé pour toi)
Tu tournes DÉJÀ dans un worktree isolé sur ta branche. **NE FAIS PAS `git worktree add`, NE CHANGE PAS DE BRANCHE, NE FAIS PAS `git checkout -b`.** Commits directement sur la branche courante. (D'autres agents tournent en parallèle dans d'autres worktrees — changer de branche = course git qui casse tout.)

## Discipline de commit
- **UNE tranche = UN commit atomique.** Fais le maximum, dans l'ordre du brief. Un batch partiel est acceptable.
- Après CHAQUE tranche, typecheck. Ne considère QUE les erreurs dans les fichiers de TA vague ; ignore les erreurs environnementales `Cannot find module 'openai'/'chalk'/'open'/'google-auth-library'` (elles viennent d'un `node_modules` incomplet dans le worktree, hors de ton périmètre).
- **NE PUSH JAMAIS. NE MERGE JAMAIS.** Ta branche + tes commits suffisent. Fable gate + câble + merge.
- `git add` **explicite fichier par fichier**, jamais `-A`/`.`. Ne touche JAMAIS `.codebuddy/*`, `ETUDE-*.md`, `buddy-memory/`, `COWORK-*BRIEF*.md`, `CORE-*BRIEF*.md`, `CODEX-*.md`, `AUTOPILOT-*.md`.
- Trailer de commit EXACT :
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Wten2ENavfScZnAfZRCSix
  ```
  Conventional Commits : `feat(cowork): <slice>` ou `feat(tools): <slice>`.

## Contraintes DURES
1. **Fichiers NEUFS uniquement**, dans la zone que ton brief indique. Tests sous `cowork/tests/` (front) ou `tests/tools/` (noyau).
2. **INTERDIT de modifier un fichier existant.** Zéro god-file : `cowork/src/renderer/App.tsx`, `store/index.ts`, `preload/index.ts`, `components/NewShell.tsx`, `cowork/src/main/index.ts`, `i18n/locales/*.json`, `cowork/package.json`, `package.json` racine, `src/codebuddy/tools.ts`, `src/agent/codebuddy-agent.ts`, `src/tools/registry/index.ts`, `src/tools/metadata.ts`. Que du neuf.
3. **Découplage total.** Composants renderer = **props-driven** (données par props typées, actions par callbacks) ; **aucun** accès au store Zustand ni à `window.electronAPI`. Services main = **exportent une fonction `registerXxx(ipcMain, deps)`** + des constantes de noms de canaux ; **aucun** `ipcMain.handle` au niveau module. Tools noyau = classe `ToolResult`, **never-throws**.
4. **Zéro dépendance npm ajoutée.** Utilise ce qui est déjà installé (React, lucide-react, react-i18next, `@uiw/react-codemirror` + `@codemirror/*`, `@xterm/xterm` + `@xterm/addon-fit`, highlight.js).
5. **Sécurité** : file ops bornées à un `root` projet (rejette `..`/absolu-hors-root/null-byte, fail-closed) ; preview/URL **loopback-only** ; pas de réseau sortant ni commande arbitraire sauf mandat explicite du brief ; secrets jamais loggés/retournés.

## Conventions de code
- TS strict, single quotes, semicolons, 2-space indent, imports ESM avec extension `.js`.
- **Style** = Tailwind tokens sémantiques (`bg-surface`, `bg-muted`, `text-muted-foreground`, `border-border`, `bg-primary`, `text-foreground` ; statuts vert/ambre/rouge distincts de l'accent). Modèles : `cowork/src/renderer/components/SciencePanel.tsx`, `WorkflowProPanel.tsx`, `MessageCard.tsx`. **N'invente pas de couleurs.**
- Icônes `lucide-react`. Libellés FR en dur OK (i18n extraite par l'intégrateur). Réutilise les primitives `components/ui/{StatTile,Pill,SectionCard,EmptyState}.tsx` si utile.
- Composants = fonctions React nommées PascalCase de fichier ; modules logiques kebab-case ; **fonctions pures testables** pour toute la logique (agrégation/tri/format/validation).
- Info-design (vues scannées) : résumé avant détail ; état encodé dans la forme (pill/chip/barre) ; `tabular-nums` pour les chiffres ; conteneurs larges en `overflow-x-auto` ; graphes = petit SVG/Canvas à la main (pas de lib).

## Format de chaque tranche
(a) le composant/service ; (b) le module logique pur associé (types + fonctions pures) ; (c) un test Vitest du module (no-mocks quand possible : tmpdir + fichiers réels). Chaque tranche mappe un vrai sous-système Code Buddy — tu construis la SURFACE, tu n'appelles pas l'outil (callbacks injectés).

## Manifeste (dernière tranche, OBLIGATOIRE)
Un fichier data-only `<vague>-wiring.ts` (aucun import de composant) listant chaque tranche livrée : `{ id, title, componentFile, logicFile?, testFile?, mount, needsData }` — la facture pour que Fable câble en une passe.

## Compte-rendu final (en français)
Tranches faites (id + fichiers + SHA), typecheck (0 hors erreurs env), tests verts (comportement réel observé), tranches non faites, limites honnêtes (rendu visuel non validé → Patrice en GUI). Ne pousse rien.
