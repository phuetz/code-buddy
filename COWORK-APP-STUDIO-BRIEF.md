# Brief — App Studio (bolt.diy-like) pour Cowork

Tu es **GPT-5.5 (Codex)**. Tu construis un **App Studio** dans **Cowork** (la GUI Electron de Code Buddy) : inspiré de **bolt.diy** — l'utilisateur décrit une app en langage naturel → l'agent scaffolde un projet web → il tourne dans un **preview live embarqué** → l'utilisateur itère en chat, avec **file tree + éditeur de code + terminal**. Différence clé vs bolt.diy : Cowork est **Electron**, donc **PAS de WebContainer** — on a un vrai FS et un vrai Node.

Tu produis une grande vague de **fichiers NEUFS** (services main + composants renderer + modules logiques + tests + manifeste de câblage). **Tu ne câbles RIEN dans les god-files** — c'est l'intégrateur (Fable) qui montera tout en une passe via ton manifeste.

## Modèle de travail
```sh
cd /home/patrice/code-buddy
git worktree add -b feat/cowork-app-studio ../appstudio-wt main
cd ../appstudio-wt
ln -s /home/patrice/code-buddy/cowork/node_modules cowork/node_modules   # si absent
```
- **UNE tranche = UN commit atomique.** Fais le maximum de tranches dans l'ordre. Batch partiel OK.
- Après CHAQUE tranche : `cd cowork && npx tsc --noEmit` = **0 erreur** (⚠️ lance-le dans le worktree AVEC le symlink node_modules ; si tu vois des erreurs `Cannot find module 'openai'/'chalk'`, c'est que le `node_modules` RACINE du repo manque — ces erreurs-là sont environnementales et hors de ton périmètre, ignore-les ; ne considère QUE les erreurs dans des fichiers `cowork/`).
- **NE PUSH JAMAIS. NE MERGE JAMAIS.** Commits sur `feat/cowork-app-studio`.

## Contraintes DURES
1. **Fichiers NEUFS uniquement.** Renderer sous `cowork/src/renderer/components/studio/` (+ `utils/`), main sous `cowork/src/main/studio/`, tests sous `cowork/tests/`.
2. **INTERDIT de modifier un fichier existant.** En particulier les god-files / points de montage : `cowork/src/main/index.ts`, `cowork/src/preload/index.ts`, `cowork/src/renderer/App.tsx`, `cowork/src/renderer/store/index.ts`, `cowork/src/renderer/components/NewShell.tsx`, `cowork/package.json`. **INTERDIT de toucher le noyau `src/`** (hors `cowork/`). Tu n'ajoutes AUCUNE dépendance npm (CodeMirror 6 + xterm sont **déjà installés**, voir plus bas).
3. **Découplage** : chaque composant renderer est **props-driven** (données par props, actions par callbacks). Chaque service main **exporte une fonction d'enregistrement** `registerXxx(ipcMain, deps)` que l'intégrateur appellera — tu n'appelles pas `ipcMain.handle` au niveau module (sinon effet de bord à l'import). Tu exposes aussi les **noms de canaux** en constantes exportées.
4. `git add` **explicite fichier par fichier**. Ne touche jamais `.codebuddy/*`, `ETUDE-*.md`, `buddy-memory/`, `COWORK-*BRIEF*.md`.
5. Trailer de commit, exactement :
   ```
   Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
   Claude-Session: https://claude.ai/code/session_01Wten2ENavfScZnAfZRCSix
   ```
   Conventional Commits : `feat(cowork): <slice>`.

## Conventions Cowork
- TS strict, single quotes, semicolons, 2-space indent, ESM imports en `.js`.
- **Style** = Tailwind tokens sémantiques (voir `SciencePanel.tsx`, `WorkflowProPanel.tsx`, `FileTree.tsx`) : `bg-surface`, `text-muted-foreground`, `border-border`, `bg-muted`, `bg-primary`… N'invente pas de couleurs.
- Icônes `lucide-react`. Libellés FR en dur OK (l'intégrateur extraira l'i18n). Ne touche pas `i18n/locales/*.json`.
- Composants = fonctions React nommées `export function XxxPane(props: XxxProps)`, fichiers PascalCase ; modules logiques kebab/camel.

## Dépendances DISPONIBLES (déjà installées, importe-les librement)
- **Éditeur** : `@uiw/react-codemirror` (default export `CodeMirror`) + langages `@codemirror/lang-javascript`, `@codemirror/lang-html`, `@codemirror/lang-css`, `@codemirror/lang-json` + thème `@codemirror/theme-one-dark`.
- **Terminal** : `@xterm/xterm` (`import { Terminal } from '@xterm/xterm';` + `import '@xterm/xterm/css/xterm.css';`) + `@xterm/addon-fit` (`FitAddon`).
- Déjà là : `react`, `lucide-react`, `react-i18next`, `highlight.js`, `zustand` (mais NE lis PAS le store — props only).

## BACKEND EXISTANT que tu réutilises (via le noyau, PAS à réécrire)
L'App Studio s'appuie sur des outils du **noyau Code Buddy** que l'agent appelle déjà. Côté main tu peux invoquer le noyau via `loadCoreModule` (modèle `cowork/src/main/ipc/ckg-ipc.ts` / `science-ipc.ts`). Outils noyau clés (ne les recode pas — tu construis la SURFACE + le service qui les orchestre) :
- **`app_server`** (`src/tools/app-server-tool.ts`, `getAppServerTool()`) : `start({command,url,cwd,timeoutMs})` spawn un dev server, vérifie loopback + port libre, attend la readiness, **enregistre le dev-origin** ; retourne `{pid, origin, url}`. `stop(pid)`, `status()`, `logs(pid)`. **C'est LE moteur du dev server** — ton service main l'orchestre.
- **`TemplateEngine`** (`src/templates/project-scaffolding.ts`, `getTemplateEngine()`/`generateProject()`) : scaffolde `react-ts` (Vite+React+TS), `express-api`, `node-cli` avec interpolation `{{var}}` + `npm install`. **Orphelin aujourd'hui** — tu l'exposes.
- **`web_test`** (`src/tools/registry/web-test-tool.ts`) : navigue une URL loopback, capture console/réseau/**screenshot**/logs serveur. Sert de moteur de preuve du preview.

## CONTRAINTES DE SÉCURITÉ OBLIGATOIRES (le feature DOIT les respecter)
1. **Preview loopback-only.** Le `PreviewPane` ne pointe QUE vers une URL `http://127.0.0.1:<port>` / `localhost` fournie par `app_server` (qui a enregistré l'origin). Jamais une URL arbitraire. iframe avec `sandbox="allow-scripts allow-same-origin"` (pattern `WorkflowProPanel.tsx:122`).
2. **`app_server` n'adopte jamais un port déjà occupé** — c'est lui qui spawn. Ton service ne doit pas contourner ça.
3. **Origin lié au process** : quand le serveur meurt, l'origin est déenregistré → le preview doit gérer l'état « serveur mort » proprement (écran d'erreur, pas d'iframe cassée).
4. **File ops confinées à un workspace root.** Toute lecture/écriture de fichier via ton IPC doit être **bornée à un répertoire projet** passé explicitement : rejette `..`, chemins absolus hors racine, null-bytes (modèle `cowork/src/main/index.ts` `workspace.readDir` qui filtre déjà). Fail-closed.
5. **Écriture = confirmée.** L'IPC d'écriture de fichier ne doit écrire QUE dans le workspace projet courant ; documente que l'intégrateur branchera la confirmation utilisateur.

---

# LES TRANCHES

## PARTIE 1 — Services MAIN (fichiers neufs sous `cowork/src/main/studio/`)

### M1 — dev-server-service (généralise le lancement de dev server)
`main/studio/dev-server-service.ts` : une classe `StudioDevServer` qui **orchestre `app_server` du noyau** via `loadCoreModule('tools/app-server-tool.js')` → `getAppServerTool()`. Méthodes : `start({cwd, command, url})` → `{pid, origin, url}` ; `stop(pid)` ; `status()` ; `logs(pid)`. Gère **plusieurs instances** (Map par pid). Détecte la mort du process (via `app_server` status) et expose un état. Never-throws (retourne `{ok:false,error}`). AUCUN `ipcMain.handle` ici.
- `main/studio/dev-server-ipc.ts` : `export const DEV_SERVER_CHANNELS = { start:'studio.dev.start', stop:'studio.dev.stop', status:'studio.dev.status', logs:'studio.dev.logs' }` + `export function registerDevServerIpc(ipcMain, service)` qui `ipcMain.handle` chaque canal en délégant au service. + un helper de **push de logs** `pushDevLogs(webContents, pid, lines)` sur un canal `studio.dev.log` (streaming).
- Test `tests/studio-dev-server.test.ts` : mock du core module, vérifie start/stop/status délèguent + never-throw.

### M2 — studio file ops (lecture/écriture confinée)
`main/studio/studio-files.ts` : fonctions pures + I/O bornées à un `root` : `readProjectFile(root, relPath)`, `writeProjectFile(root, relPath, content)`, `listProjectTree(root)`, `createFile(root, relPath)`, `renameEntry(root, from, to)`, `deleteEntry(root, relPath)`. **Chaque fonction valide le chemin** via un helper `safeJoin(root, relPath)` qui rejette `..`/absolu-hors-root/null-byte et retourne `null` si invalide (fail-closed). Never-throws.
- `main/studio/studio-files-ipc.ts` : `STUDIO_FILE_CHANNELS` + `registerStudioFilesIpc(ipcMain)`.
- Test `tests/studio-files.test.ts` : `safeJoin` rejette `../etc/passwd`, chemins absolus, null-byte ; accepte un chemin normal. read/write round-trip dans un tmpdir.

### M3 — command runner (terminal backend, streaming, SANS node-pty)
`main/studio/command-runner.ts` : `runCommand({cwd, command, id})` via `child_process.spawn(command, {shell:true, cwd})`, **stream stdout/stderr** ligne par ligne à un callback, ring buffer borné, `kill(id)` SIGTERM→SIGKILL. Multi-instance (Map par id). Never-throws. (PAS de vrai PTY — suffisant pour lancer des commandes projet + voir la sortie ; documente la limite : pas d'interactivité clavier type `vim`.)
- `main/studio/command-runner-ipc.ts` : `COMMAND_CHANNELS = { run:'studio.cmd.run', kill:'studio.cmd.kill' }` + canal push `studio.cmd.output` + `registerCommandRunnerIpc(ipcMain, runner, webContentsGetter)`.
- **Sécurité** : le runner ne s'exécute que dans le `cwd` projet fourni ; documente que l'intégrateur doit borner `cwd` au workspace + passer par le validateur de commandes du noyau si souhaité.
- Test `tests/command-runner.test.ts` : run `echo hello` → capture « hello » ; kill termine.

### M4 — scaffold service (expose le TemplateEngine orphelin)
`main/studio/scaffold-service.ts` : `scaffoldProject({template, targetDir, vars})` via `loadCoreModule('templates/project-scaffolding.js')` → `getTemplateEngine().generate(...)`. Templates supportés : `react-ts`, `express-api`, `node-cli`. Retourne `{ok, projectDir, files:string[]}`. Never-throws.
- `main/studio/scaffold-ipc.ts` : `SCAFFOLD_CHANNELS = { list:'studio.scaffold.list', generate:'studio.scaffold.generate' }` + `registerScaffoldIpc(ipcMain, service)`. `list` retourne le catalogue de templates.
- `utils/... ` non ; garde en main.
- Test `tests/scaffold-service.test.ts` : mock du core, `list` retourne ≥3 templates, `generate` délègue.

## PARTIE 2 — Composants RENDERER (fichiers neufs sous `cowork/src/renderer/components/studio/`)

### R1 — CodeEditorPane (CodeMirror 6)
`studio/CodeEditorPane.tsx` : wrapper `@uiw/react-codemirror`. Props `{ path: string; value: string; onChange: (v:string)=>void; onSave: ()=>void; readOnly?: boolean }`. Choisit l'extension de langage selon l'extension de fichier (`.ts/.tsx/.js/.jsx`→javascript, `.html`→html, `.css`→css, `.json`→json), thème `oneDark`, `Ctrl/Cmd+S`→`onSave`. Barre de titre avec le chemin + état modifié (point).
- `utils/editor-language.ts` : `languageForPath(path): 'javascript'|'html'|'css'|'json'|'text'` (pur) + test `tests/editor-language.test.ts`.

### R2 — TerminalPane (xterm)
`studio/TerminalPane.tsx` : monte un `Terminal` `@xterm/xterm` + `FitAddon`, thème sombre cohérent. Props `{ output: string[]; onInput?: (line:string)=>void; onClear?: ()=>void }` — écrit `output` dans le terminal (append incrémental via un ref pour ne pas tout re-render), `onInput` sur Entrée si fourni. Import du CSS xterm. Nettoie le Terminal au démontage. Respecte `prefers-reduced-motion` (pas de cursor blink si réduit).

### R3 — PreviewPane (iframe→localhost)
`studio/PreviewPane.tsx` : Props `{ url: string | null; status: 'idle'|'starting'|'running'|'dead'; onReload: ()=>void; onOpenExternal?: ()=>void }`. Si `running` + `url` : iframe `sandbox="allow-scripts allow-same-origin" src={url}` avec un key qui change au reload (force refresh). Sinon : état vide/erreur honnête (« serveur arrêté », bouton relancer). Barre d'adresse read-only montrant l'URL loopback + boutons reload / ouvrir dans le navigateur. **Jamais d'URL non-loopback** : garde un check `isLoopbackUrl(url)` qui refuse d'afficher sinon.
- `utils/loopback-url.ts` : `isLoopbackUrl(url): boolean` (127.0.0.0/8, localhost, ::1, http(s) only) + test `tests/loopback-url.test.ts` (accepte localhost:5173, refuse example.com et file://).

### R4 — StudioFileTree
`studio/StudioFileTree.tsx` : arbre du projet. Props `{ tree: TreeNode[]; activePath?: string; onOpen: (path:string)=>void; onCreate?; onRename?; onDelete? }`. Récursif, dirs d'abord, lazy-expand, icône par type de fichier (lucide). Purement présentationnel (le chargement des données est fait par le parent via l'IPC M2).
- `utils/file-tree-model.ts` : type `TreeNode` + `sortTree(nodes)` (dirs first, alpha) + `fileIconName(path): string` + test `tests/file-tree-model.test.ts`.

### R5 — StudioComposer (barre d'intention du Studio)
`studio/StudioComposer.tsx` : le champ « décris l'app à construire » + choix de template + bouton Générer. Props `{ templates: TemplateCard[]; onScaffold: (req)=>void; onPrompt: (text)=>void; busy?: boolean }`. Chips de suggestions (« une todo app React », « une API Express CRUD », « une landing page »).
- `utils/studio-intent.ts` : `suggestTemplate(prompt): 'react-ts'|'express-api'|'node-cli'` (heuristique) + test `tests/studio-intent.test.ts`.

### R6 — BuildStatusStrip
`studio/BuildStatusStrip.tsx` : bandeau d'état du build/dev-server (scaffolding → installing → starting → running/dead) + durée + bouton stop. Props `{ phase; elapsedMs; onStop }`. Réutilise les primitives UI `components/ui/{StatTile,Pill}.tsx` si présentes (elles le sont — batch Genspark), sinon inline.

### R7 — AppStudioView (LE composant qui compose tout)
`studio/AppStudioView.tsx` : le layout plein écran du Studio, façon bolt.diy : à gauche le **StudioFileTree**, au centre-haut le **CodeEditorPane** (onglet éditeur) / **PreviewPane** (onglet preview) commutables, en bas le **TerminalPane**, en haut le **StudioComposer** + **BuildStatusStrip**. **Panes redimensionnables** (drag simple, ou grid fixe si le drag est trop coûteux — au choix, garde simple). Props = TOUT ce dont il a besoin, injecté (aucun IPC direct ici) : `{ tree, activeFile, fileContent, previewUrl, previewStatus, terminalOutput, buildPhase, templates, on... callbacks }`. C'est une **vue de présentation pure** que l'intégrateur branchera aux IPC. Fournis un **état vide honnête** (« Décris une app pour commencer »).

## PARTIE 3 — Colle & manifeste

### G1 — hook d'orchestration (pur, testable)
`studio/use-app-studio.ts` : un hook React qui, à partir de handles d'API injectés (`{ devServer, files, commands, scaffold }` — des interfaces typées, PAS `window.electronAPI` en dur), expose l'état + les actions de l'AppStudioView (`scaffold`, `openFile`, `saveFile`, `startDev`, `stopDev`, `runCommand`). **Les API sont injectées** (défaut = objets no-op) pour rester testable et découplé du preload. Documente en tête que l'intégrateur passera les vraies API `window.electronAPI.studio.*`.
- Type les interfaces d'API dans `studio/studio-api.ts` (contrats `DevServerApi`, `FilesApi`, `CommandsApi`, `ScaffoldApi`) — ce fichier est le **contrat** que l'intégrateur implémentera dans le preload.

### G2 — MANIFESTE de câblage (OBLIGATOIRE, dernière tranche)
`studio/app-studio-wiring.ts` — data-only, aucun import de composant. Décris précisément à l'intégrateur ce qu'il doit monter :
```ts
export interface StudioWiring {
  mainServices: { file: string; registerFn: string; channels: string[] }[]; // M1-M4
  preloadNamespace: { name: 'studio'; methods: { key: string; channel: string; kind: 'invoke'|'on' }[] };
  primaryView: { id: 'studio'; label: string; component: string };         // R7 dans NewShell
  apiContract: string;  // chemin de studio-api.ts
  notes: string[];      // toute étape manuelle (confirmation d'écriture, bornage cwd…)
}
export const APP_STUDIO_WIRING: StudioWiring = { /* rempli avec la réalité de ce que tu as livré */ };
```

---

# COMPTE-RENDU FINAL (en français)
Liste des tranches faites (id + fichiers + SHA), résultat tsc (0 hors erreurs environnementales `openai/chalk`), nombre de tests verts, tranches non faites, limites honnêtes (ex. terminal sans PTY, preview visuel non validé → Patrice en GUI). Ne pousse rien. La branche `feat/cowork-app-studio` suffit.
