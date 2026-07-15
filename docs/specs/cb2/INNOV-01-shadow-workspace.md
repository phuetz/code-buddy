# SPEC-CB2 — INNOV-1 : Shadow Workspace (exécution spéculative)

Tu travailles dans un worktree git du repo **Code Buddy** (agent de codage IA multi-provider,
TypeScript strict ESM, tests Vitest). Branche : `cb2/shadow-workspace`. Campagne « Code Buddy 2 ».

## Règles du repo (OBLIGATOIRES)
- Imports relatifs avec extension `.js` même depuis des `.ts`. Pas de `any`. `noUncheckedIndexedAccess` ON.
- `logger` (`src/utils/logger.js`) en production, jamais `console.*` (sauf sortie CLI dans `src/commands/`).
- Fichiers kebab-case ; tests UNIQUEMENT sous `tests/` : `npm test -- tests/<fichier>`.
- Feature OPT-IN par env var — env var absente/false ⇒ ZÉRO changement de comportement.
  Chemins d'erreur fail-open côté écriture (une panne du shadow ne bloque JAMAIS l'agent : on loggue et on laisse passer)
  mais le résultat d'un run shadow en échec est remonté comme annotation.
- Conventional Commits. Avant chaque commit : `npm run typecheck` (0 erreur) + tes tests ciblés verts.
  N'exécute PAS la suite complète (~27K tests). `npm install --no-audit --no-fund` si node_modules manque.
- Ne commite jamais : SPEC-CB2.md, node_modules, état `.codebuddy/`.
- Documente dans `docs/cb2/shadow-workspace.md` (nouveau fichier commité). NE MODIFIE PAS CLAUDE.md.

## Mission
Chaque écriture de fichier proposée par l'agent est d'abord appliquée dans un **worktree git
fantôme** où une commande de validation (typecheck et/ou tests ciblés) s'exécute. Si la validation
échoue, l'écriture est refusée avec le détail de l'erreur renvoyé à l'agent (qui corrige et
re-propose). Si elle passe — ou si le shadow est indisponible — l'écriture continue normalement.
L'agent ne propose plus du code plausible : il propose du code **déjà validé**.

## Ancrage dans l'existant (à lire d'abord)
- `src/review/write-gate.ts` — `reviewGatedWrite()` : LE point de passage des 5 surfaces
  d'écriture (apply_patch, create_file/write_file, str_replace, multi_edit). Le shadow s'insère
  au même niveau (après la confirmation utilisateur, avant l'application réelle).
- `src/tools/review-gate-helper.ts` — `maybeReviewGatedWrite()` : le helper de plomberie par outil.
- `src/review/` — regarde comment le verdict annoté est renvoyé comme erreur d'outil (motif à imiter).

## Périmètre P0
1. `src/speculative/shadow-workspace.ts` :
   - `class ShadowWorkspace` : gère UN worktree fantôme persistant par repo, sous
     `~/.codebuddy/shadow/<hash-du-chemin-repo>/` (jamais dans le working tree).
     Création lazy (`git worktree add --detach`), resync avant chaque run
     (`git -C shadow checkout --detach HEAD_du_repo` + clean des fichiers de l'essai précédent).
   - `runSpeculative(files: {path, content}[]): Promise<ShadowResult>` : écrit les contenus proposés
     dans le shadow, symlink `node_modules` du repo principal s'il existe (jamais de npm install),
     exécute la commande de validation avec timeout (`CODEBUDDY_SHADOW_TIMEOUT_MS`, défaut 120000),
     retourne `{ok, exitCode, stdoutTail, durationMs}` (tail = 4000 derniers caractères).
   - Commande de validation : `CODEBUDDY_SHADOW_CMD` si définie ; sinon auto-détection :
     `package.json` a un script `typecheck` → `npm run typecheck` ; sinon tsconfig.json présent →
     `npx tsc --noEmit` ; sinon shadow inactif (log + pass-through).
   - Exécution via child_process injectable (constructeur accepte un `spawnFn`) pour les tests.
2. Câblage : dans le chemin de `reviewGatedWrite()` (ou un wrapper au même niveau), gardé par
   `CODEBUDDY_SHADOW_WORKSPACE=true`. Échec de validation ⇒ l'outil d'écriture retourne une erreur
   structurée `shadow validation failed` + le tail de sortie, SANS appliquer. Panne du shadow
   lui-même (git absent, timeout de setup) ⇒ log warn + écriture normale (fail-open).
3. Cache de célérité : si les mêmes `{path, sha256(content)}` ont déjà validé dans la session,
   ne pas relancer (Map en mémoire).
4. CLI de diagnostic : `buddy shadow status|run` (nouveau fichier `src/commands/shadow.ts`, motif
   Commander des commandes existantes, lazy-loadé depuis `src/index.ts`) : `status` = état du
   worktree fantôme + config ; `run` = valide le working tree courant dans le shadow.

## Tests exigés (`tests/speculative/shadow-workspace.test.ts`)
- Repo git temporaire réel (tmpdir + `git init` + commit) : création lazy du shadow, resync, écriture des fichiers proposés.
- Validation avec une commande factice (`sh -c "exit 0"` / `"exit 1"`) injectée via `CODEBUDDY_SHADOW_CMD` : ok/fail + stdoutTail.
- Timeout : commande `sleep` + `CODEBUDDY_SHADOW_TIMEOUT_MS=200` ⇒ résultat fail avec indication de timeout.
- Fail-open : repo sans git (dossier nu) ⇒ `runSpeculative` retourne un résultat « indisponible » sans throw.
- Cache : deuxième run identique ne re-spawne pas (spawnFn spy).
- Câblage : env var absente ⇒ le wrapper n'instancie RIEN (spy sur le module).

## Critères de done
- `npm run typecheck` : 0 erreur. Tests ciblés verts.
- Sans `CODEBUDDY_SHADOW_WORKSPACE`, aucun chemin d'écriture ne change (prouvé par test).
- `docs/cb2/shadow-workspace.md` écrit (env vars, architecture, limites).
- Commits Conventional (`feat(speculative): …`).

## Interdits
- Ne touche PAS à la logique interne du diff-review gate (`src/review/*` : insertion au point
  d'appel uniquement), ni aux surfaces d'outil au-delà de la remontée d'erreur existante.
- Pas de npm install dans le shadow. Pas de suppression du worktree principal. Pas de hook git global.
