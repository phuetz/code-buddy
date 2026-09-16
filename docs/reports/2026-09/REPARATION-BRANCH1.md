# Réparation BRANCH1 — tests qui créent `branch/` et `feature-branch/` à la racine

Clone : `~/DEV/cb-branch1-2026-09-03`
Branche : `fix/branch1-test-cwd-2026-09-03`
HEAD de départ : `94066f856`
Agent : Antigravity (Gemini 3.7 Flash)
Date : 2026-09-03
HOME temporaire : `_qa/branch1/home` (dans le clone uniquement)
Original `~/code-buddy` : interdit en écriture

## Mission

Identifier le test qui, lors d’un `npx vitest run` large, crée à la racine du clone deux dossiers `branch/` et `feature-branch/` (copies complètes du dépôt avec `.git`, ~593 Mo chacun).
Hypothèse : un `git worktree add` ou un `git clone` dans le cwd réel au lieu d’un dossier temporaire ou avec des mocks appropriés.

## Constat & Recherche statique

Recherche via `git grep -n "worktree add\|'feature-branch'\|\"feature-branch\"\|git clone" tests src scripts` :
- `tests/commands/worktree-handlers.test.ts` (lignes 44 et 111) appelait `handleWorktree(['add', 'feature-branch'])` et `handleWorktree(['add', 'branch'])`.
- Dans `src/commands/handlers/worktree-handlers.ts`, la fonction `addWorktree` appelle `execFileSync('git', ['worktree', 'add', '-b', branchName, resolvedPath], { stdio: 'pipe' })`.
- En l'absence de mock `child_process` / `execFileSync`, l'exécution de ce test lançait une vraie commande `git worktree add -b feature-branch <racine>/feature-branch` et `git worktree add -b branch <racine>/branch`, créant les deux répertoires de 593 Mo à la racine du dépôt.

## Reproduction

1. Avant exécution du test :
   `ls -ld branch feature-branch` -> `cannot access 'branch': No such file or directory` (code 2).
2. Lancement du fichier ciblé :
   `HOME=~/_qa/branch1/home npx vitest run tests/commands/worktree-handlers.test.ts`
3. Constat après exécution :
   `ls -ld branch feature-branch` ->
   `drwxrwxr-x 43 ... branch`
   `drwxrwxr-x 43 ... feature-branch`
   Et `git worktree list` listait les deux worktrees attachés au dépôt.
4. Nettoyage initial :
   `git worktree remove --force branch && git worktree remove --force feature-branch && git branch -D branch feature-branch`.

## Correctif

Dans `tests/commands/worktree-handlers.test.ts` :
1. Mock de `child_process.execFileSync` via `jest.mock('child_process', ...)` simulant les commandes git nécessaires (`rev-parse`, `worktree list`, `worktree prune --dry-run`).
2. Mock de `fs.existsSync` via `jest.mock('fs', ...)` renvoyant `false` par défaut pour éviter les collisions de chemins d'arborescence.
3. Mise à jour du bloc `describe('Worktree Error Handling')` pour mocker proprement l'erreur git au lieu d'un `resetModules()` inopérant.

## Preuves

1. Exécution des tests worktree après correctif :
   `HOME=~/_qa/branch1/home npx vitest run tests/commands/worktree-handlers.test.ts tests/commands/worktree-handlers-shell.test.ts`
   -> 2 passed, 18 passed (159 ms).
2. Vérification de non-création des répertoires :
   `ls -ld branch feature-branch` -> code 2 (aucun dossier créé).
   `git worktree list` -> uniquement la racine du clone `fix/branch1-test-cwd-2026-09-03`.
3. Typecheck :
   `npx tsc --noEmit -p .` -> code 0 (0 erreur).
4. ESLint ciblé :
   `npx eslint tests/commands/worktree-handlers.test.ts` -> code 0 (0 erreur).
5. Garde-fou sécurité / données personnelles :
   `HOME=~/_qa/branch1/home npx vitest run tests/security/donnees-personnelles.test.ts` -> 1 passed (1).
6. Vérification diff :
   `git diff --check` -> code 0.

## Ouvert

Rien. Le test suspect a été formellement identifié, reproduit, corrigé avec confinement complet et vérifié.
