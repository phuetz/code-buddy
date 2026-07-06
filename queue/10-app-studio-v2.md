# Vague — App Studio v2 : compléter bolt.diy (deploy / git / export / import / diff)

Lis d'abord **`/home/patrice/code-buddy/CODEX-CONVENTIONS.md`** (règles communes). Ce brief complète l'App Studio v1 (déjà sur main) pour atteindre la **parité bolt.diy**.

**Zone (fichiers neufs uniquement)** : renderer sous `cowork/src/renderer/components/studio2/`, services main sous `cowork/src/main/studio2/`, tests sous `cowork/tests/`.

**Contexte v1 déjà livré** (ne le recode pas, réutilise ses contrats) : `cowork/src/main/studio/` (dev-server-service, studio-files, command-runner, scaffold-service) + `cowork/src/renderer/components/studio/` (CodeEditorPane, TerminalPane, PreviewPane, StudioFileTree, AppStudioView…) + le contrat `studio/studio-api.ts`. Le manifeste v1 : `studio/app-studio-wiring.ts`.

## Tranches (1 commit chacune)
1. **DeployService** (`main/studio2/deploy-service.ts` + `deploy-ipc.ts`) : déploie un dossier build vers une cible statique (surge/netlify-cli/vercel-cli SI présent, sinon zip local). `registerDeployIpc`. Détecte les CLIs dispo (`which`), never-throws. Test `tests/studio2-deploy.test.ts` (mock des CLIs absents → repli zip).
2. **GitService** (`main/studio2/git-service.ts` + `git-ipc.ts`) : `init`, `status`, `commit(message)`, `log` **bornés au projet** via `execFile('git', …)` — jamais de commande destructrice (pas de reset --hard/clean/push). `registerGitIpc`. Test : `git init` tmpdir → commit → log.
3. **ExportService** (`main/studio2/export-service.ts` + `export-ipc.ts`) : exporte le projet en `.zip` (archiver déjà présent ? sinon impl minimale zip), + `importFolder(path)` copie un dossier existant dans le workspace. Bornage strict. Test.
4. **DeployPanel** (`studio2/DeployPanel.tsx`) : cible de déploiement, statut, URL publique, bouton déployer. Props-driven. `utils/deploy-model.ts` (`deployTargets`, `statusTone`) + test.
5. **GitPanel** (`studio2/GitPanel.tsx`) : status (staged/modifiés/untracked), champ message, bouton commit, historique. Props-driven. `utils/git-status-model.ts` (`partitionChanges`, `canCommit`) + test.
6. **DiffView** (`studio2/DiffView.tsx`) : diff avant/après d'un fichier (rendu 2 colonnes ou unifié, coloration ajout/suppression). Props `{ before, after, path }`. `utils/diff-model.ts` (`computeLineDiff(before, after): DiffLine[]` — algo LCS simple) + test (ajouts/suppressions/inchangés).
7. **ProjectSnapshotBar** (`studio2/ProjectSnapshotBar.tsx`) : backup/restore d'un état projet (liste de snapshots, restaurer). Props-driven. `utils/snapshot-model.ts` + test.
8. **StudioChatBridge** (`studio2/use-studio-chat.ts`) : hook pur qui traduit une instruction chat (« ajoute un bouton ») en intention d'édition pour l'agent (API injectée). `utils/edit-intent.ts` (`parseEditIntent(text): {targetHint?, action}`) + test.
9. **Manifeste** `studio2/app-studio-v2-wiring.ts` (data-only).
