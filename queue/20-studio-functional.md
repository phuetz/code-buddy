# Vague — App Studio pleinement fonctionnel (le flux bolt.diy end-to-end)

Tu es GPT-5.5 (Codex). Tu rends l'**App Studio** de Cowork VRAIMENT fonctionnel de bout en bout, en branchant l'UI aux APIs backend DÉJÀ exposées. Tu es dans un worktree isolé (branche `feat/studio-functional`) — ne change pas de branche, ne fais pas `git worktree add`.

## Contexte : le backend MARCHE déjà, l'UI est branchée mais incomplète
`window.electronAPI.studio.*` est exposé et fonctionne (validé) :
- `scaffold.list()` → 3 templates (react-ts/express-api/node-cli) ; `scaffold.generate({template, targetDir, vars})` → génère un vrai projet (git init + npm install). ⚠️ Actuellement le TemplateEngine crée dans `/tmp/<projectName>` et IGNORE `targetDir` — l'UI doit passer un vrai `targetDir` (voir tâche 3).
- `devServer.start({cwd, command, url})` / `stop` / `status` / `logs` / `onLog` — lance un dev server via app_server (loopback).
- `files.read/write/list/create/rename/delete` — ops fichiers bornées au projet.
- `commands.run({cwd, command, id})` / `kill` / `onOutput` — terminal (spawn streamé).

Les composants existent sous `cowork/src/renderer/components/studio/` : `AppStudioView.tsx` (compose tout), `StudioComposer.tsx` (le prompt+template+Générer), `StudioFileTree.tsx`, `CodeEditorPane.tsx`, `TerminalPane.tsx`, `PreviewPane.tsx`, `BuildStatusStrip.tsx`, `use-app-studio.ts` (hook orchestrateur), `studio-api-bridge.ts` (construit les APIs depuis window.electronAPI). Le hook reçoit les APIs injectées.

## Objectif : le flux complet marche
Décrire une app → choisir template → **Générer** → voir le scaffold (file tree peuplé) → éditer un fichier (sauve) → lancer le dev server → **preview live** dans l'iframe → terminal utilisable.

## Tâches (améliore les composants + le hook existants ; commits atomiques)
1. **Feedback de génération temps réel** : pendant scaffold puis devServer, `BuildStatusStrip` reflète les phases (`idle → scaffolding → installing → starting → running | error`) avec la durée. Le hook expose `buildPhase`. Affiche les erreurs lisiblement (ex. l'erreur `Missing required variable`).
2. **Variables du template** : `node-cli` exige `binName` (+ `projectName`), les autres ont leurs vars. Quand un template est choisi, dérive des valeurs par défaut sensées du prompt/nom (ex. `binName` = slug du nom d'app) OU affiche un petit formulaire des vars requises. Ne JAMAIS envoyer un generate qui échouera sur une var manquante — pré-remplis.
3. **Dossier de destination + fix targetDir** : ajoute un champ « Dossier » (défaut = un sous-dossier du workspace courant, ex. `<workingDir>/<appName>`), et passe-le comme `targetDir` à `scaffold.generate`. Après génération, utilise le `projectDir` RETOURNÉ (`result.data.projectDir`) comme racine du projet pour le file tree / dev server / éditeur (c'est la source de vérité, même si le backend a mis ailleurs). Ainsi le reste du flux pointe sur le vrai dossier généré.
4. **File tree peuplé** : après génération, charge `files.list(projectDir)` → `StudioFileTree` affiche l'arbre ; clic sur un fichier → `files.read` → ouvre dans `CodeEditorPane`. Ignore `node_modules`/`.git`.
5. **Éditeur qui sauve** : `CodeEditorPane` montre le contenu, `Ctrl/⌘+S` → `files.write(path, content)` + feedback « enregistré ».
6. **Terminal fonctionnel** : `TerminalPane` branché sur `commands.run({cwd: projectDir, command})` + abonnement `commands.onOutput` pour streamer stdout/stderr. Un champ pour taper une commande (ex. `npm run build`).
7. **Preview live** : bouton « Lancer » → `devServer.start({cwd: projectDir, command: 'npm run dev', url: 'http://127.0.0.1:<port libre>/'})` → quand `running`, `PreviewPane` affiche l'iframe loopback ; bouton stop → `devServer.stop`. Gère l'état « serveur arrêté/mort » proprement (le manifeste le prévoit).

## Contraintes
- Modifie UNIQUEMENT sous `cowork/src/renderer/components/studio/` (+ `studio2/` si utile). **NE TOUCHE PAS** les god-files : `App.tsx`, `NewShell.tsx`, `store/index.ts`, `preload/index.ts`, `main/index.ts`. Le câblage (primaryView, IPC) est DÉJÀ fait — n'y touche pas.
- TS strict, single quotes, semicolons, imports `.js`. Tokens Tailwind sémantiques (`bg-surface`, `text-foreground`, `border-border`, `bg-primary`…). Icônes lucide-react.
- `git add` explicite. NE PUSH PAS, NE MERGE PAS. Commits atomiques, trailer :
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Wten2ENavfScZnAfZRCSix
  ```
  `feat(cowork): <tâche>`.
- **Gate avant de finir** (worktree, node_modules symlinké) : `cd cowork && npx tsc --noEmit` = 0 (ignore les `Cannot find module 'openai'` = node_modules racine absent) + `npx vite build` exit 0 (NE PAS casser le boot). `git status` propre.

## Compte-rendu (français)
Ce que chaque tâche a branché, comment tu as géré le targetDir (projectDir retourné), tsc/vite results, SHA(s), limites honnêtes (ex. preview non testé au runtime). Ne pousse pas — Fable gate + valide via computer-use.
