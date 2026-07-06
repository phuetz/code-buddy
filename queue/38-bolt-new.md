# Vague 38 — Enrichissement bolt.new (App Studio)

Contexte : App Studio est devenu une interface bolt.new (chat à gauche, workbench à droite : arbre + éditeur + terminal + preview + plan de dev). Cette vague ajoute des **surfaces neuves, props-driven, découplées** qui enrichissent l'expérience bolt.new. Tu construis la SURFACE + la logique pure + le test ; Fable câble dans App Studio (NewShell/AppStudioView, que tu NE touches PAS).

Rappel dur : **fichiers NEUFS uniquement** sous `cowork/src/renderer/components/studio/` (composants) et tests sous `cowork/tests/`. Aucun accès store/`window.electronAPI`. Callbacks injectés. Réutilise `lucide-react` + tokens Tailwind sémantiques. Une tranche = un commit.

## Tranche 38.1 — VerifyReportCard (rapport web_test de Code Buddy)
Rendre le rapport de l'outil `web_test` (Code Buddy vérifie l'app générée : erreurs console/page, assertions, screenshot).
- (b) `cowork/src/renderer/components/studio/web-test-report-model.ts` :
  - types : `WebTestCheck { name: string; passed: boolean; detail?: string }`, `WebTestReport { passed: boolean; url: string; checks: WebTestCheck[]; consoleErrorCount: number; networkFailureCount: number; screenshotPath?: string }`.
  - `parseWebTestResult(toolResultData: Record<string,unknown>): WebTestReport | null` — parse le `data` d'un ToolResult web_test (champs `passed`, `url`, `checks[]`, `consoleErrorCount`, `networkFailureCount`, `screenshotPath`), null si non conforme.
  - `summarizeReport(r: WebTestReport): { passed: boolean; failed: number; total: number; tone: 'success'|'danger' }`.
- (a) `cowork/src/renderer/components/studio/VerifyReportCard.tsx` — props `{ report: WebTestReport; onRerun?: () => void }`. Header PASSED/FAILED (vert/rouge), compteurs erreurs console/réseau (`tabular-nums`), liste des checks (✓/✗ + detail), vignette screenshot si `screenshotPath` (via `file://`), bouton « Relancer ».
- (c) `cowork/tests/web-test-report-model.test.ts` — parse réel + résumé + null sur données invalides.

## Tranche 38.2 — EditorTabs (onglets multi-fichiers)
bolt.new ouvre plusieurs fichiers en onglets.
- (b) `cowork/src/renderer/components/studio/editor-tabs-model.ts` :
  - type `EditorTab { path: string; dirty?: boolean }`.
  - `openTab(tabs, path)`, `closeTab(tabs, path)`, `nextActiveAfterClose(tabs, path, active): string | null` (choisit l'onglet voisin), `basename(path)`, `markDirty(tabs, path, dirty)`. Purs, immuables.
- (a) `cowork/src/renderer/components/studio/EditorTabs.tsx` — props `{ tabs: EditorTab[]; activePath: string | null; onSelect: (p)=>void; onClose: (p)=>void }`. Onglets scrollables (`overflow-x-auto`), point « modifié », croix de fermeture, icône fichier.
- (c) `cowork/tests/editor-tabs-model.test.ts`.

## Tranche 38.3 — PromptEnhancer (améliorer le prompt, façon bolt.new)
bolt.new propose d'enrichir un prompt vague avant génération.
- (b) `cowork/src/renderer/components/studio/prompt-enhance-model.ts` :
  - `enhancePrompt(prompt: string): { suggestions: string[]; enriched: string }` — DÉTERMINISTE : détecte l'absence de stack (→ suggère « en React + Vite »), de style (→ « thème sombre soigné, responsive »), de features précises ; retourne des suggestions courtes + un prompt enrichi. Vide → suggestions par défaut. Pas de LLM.
  - `isVague(prompt: string): boolean` (< 6 mots ou pas de nom/feature).
- (a) `cowork/src/renderer/components/studio/PromptEnhancer.tsx` — props `{ prompt: string; suggestions: string[]; onApply: (enriched: string)=>void; busy?: boolean }`. Puces de suggestions cliquables + bouton « Améliorer le prompt ».
- (c) `cowork/tests/prompt-enhance-model.test.ts`.

## Tranche 38.4 — Static vs dev-server (preview des apps statiques)
La génération produit souvent du HTML/CSS/JS statique (index.html) sans build. Détecter ce cas pour la preview.
- (b) `cowork/src/renderer/components/studio/static-project-model.ts` :
  - types réutilise `TreeNode` de `./utils/file-tree-model.js` (import type OK, fichier existant NON modifié).
  - `isStaticProject(tree): boolean` (contient un `index.html` à la racine ET pas de `package.json`).
  - `previewEntry(tree): string | null` (chemin de l'index.html), `describePreviewMode(tree): 'static'|'dev-server'`.
- (a) `cowork/src/renderer/components/studio/StaticPreviewNotice.tsx` — props `{ mode: 'static'|'dev-server'; entry: string | null }`. Bandeau expliquant comment la preview sera servie (statique = ouvrir index.html ; dev-server = npm run dev).
- (c) `cowork/tests/static-project-model.test.ts`.

## Tranche 38.5 (OBLIGATOIRE) — Manifeste
`cowork/src/renderer/components/studio/bolt-new-wiring.ts` (data-only, aucun import de composant) : pour chaque tranche `{ id, title, componentFile, logicFile, testFile, mount: 'app-studio', needsData }`.
