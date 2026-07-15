# SPEC-CB2 — INNOV-10 : Workspace multi-repo (raisonner sur l'écosystème)

Tu travailles dans un worktree git du repo **Code Buddy** (agent de codage IA multi-provider,
TypeScript strict ESM, tests Vitest). Branche : `cb2/multi-repo`. Campagne « Code Buddy 2 ».

## Règles du repo (OBLIGATOIRES)
- Imports relatifs avec extension `.js` même depuis des `.ts`. Pas de `any`. `noUncheckedIndexedAccess` ON.
- `logger` (`src/utils/logger.js`) en production, jamais `console.*` (sauf sortie CLI dans `src/commands/`).
- Fichiers kebab-case ; tests UNIQUEMENT sous `tests/` : `npm test -- tests/<fichier>`.
- Feature OPT-IN : active UNIQUEMENT si `CODEBUDDY_WORKSPACE=true` ET qu'un `workspace.json` existe —
  défaut ⇒ ZÉRO changement. Lecture seule STRICTE sur les repos externes en P0.
- Conventional Commits. Avant chaque commit : `npm run typecheck` (0 erreur) + tes tests ciblés verts.
  N'exécute PAS la suite complète. `npm install --no-audit --no-fund` si node_modules manque.
- Ne commite jamais : SPEC-CB2.md, node_modules, état `.codebuddy/`.
- Documente dans `docs/cb2/multi-repo.md`. NE MODIFIE PAS CLAUDE.md.

## Mission
Un `workspace.json` fédère N repos ; l'agent peut chercher et lire **à travers tout l'écosystème**
(ex. code-buddy + gitnexus-rs + NexusFile) au lieu d'être aveugle au-delà du repo courant.
Tous les concurrents sont mono-repo : c'est un différenciateur direct.

## Ancrage dans l'existant (à lire d'abord)
- Le tool `search` existant (cherche son implémentation dans `src/tools/` — probablement
  ripgrep/grep-based) : ton tool cross-repo RÉUTILISE sa mécanique de recherche, tu ne réécris
  pas un moteur.
- `src/tools/metadata.ts` — metadata + `fleetSafe` (ton tool de recherche est read-only ⇒
  `fleetSafe: true` est approprié, comme `search`).
- Le protocole « Adding a Tool » du CLAUDE.md : classe dans `src/tools/`, définition
  `src/codebuddy/tools.ts`, dispatch `CodeBuddyAgent.executeTool()`, registre
  `src/tools/registry/`, metadata.
- `src/security/` — regarde comment les chemins sont validés (pas d'échappement hors racine).

## Périmètre P0
1. `src/workspace/workspace-config.ts` :
   - Résolution du fichier : `.codebuddy/workspace.json` du repo courant, sinon
     `~/.codebuddy/workspace.json`. Format :
     `{repos: [{name, path, description?}]}`.
   - Validation au chargement : chaque `path` doit exister, être un dossier, et être un repo git ;
     entrées invalides ⇒ ignorées avec log warn (never-throws). Les chemins sont résolus absolus
     et NORMALISÉS (realpath) — c'est la racine de sécurité de tout le reste.
   - `getWorkspace()` : null si env var absente ou aucun repo valide.
2. Tool `workspace_search` (read-only, `fleetSafe: true`) :
   - Params : `{query: string, repos?: string[], max_results?: number (défaut 50, borne 200),
     glob?: string}`.
   - Cherche dans chaque repo du workspace (mécanique du tool search existant, exécutée par repo),
     résultats préfixés `<repoName>:<cheminRelatif>:<ligne>`, agrégés et bornés.
   - Sécurité : refuse toute query qui tenterait de sortir des racines (le path de chaque match
     doit rester sous le realpath du repo) ; timeout global `CODEBUDDY_WORKSPACE_TIMEOUT_MS`
     (défaut 30000).
3. Tool `workspace_read` (read-only, `fleetSafe: true`) :
   - Params : `{repo: string, path: string, offset?, limit?}` — lit un fichier d'un repo du
     workspace. REFUS (fail-closed) si le realpath résolu sort de la racine du repo (symlinks
     compris), si le fichier dépasse `CODEBUDDY_WORKSPACE_MAX_FILE_KB` (défaut 512), ou si le repo
     n'est pas dans le workspace.
4. CLI `buddy ws` (nouveau `src/commands/ws.ts`, lazy-loadé) :
   - `list` (repos + validité), `add <name> <path>`, `rm <name>` (édite le workspace.json résolu),
     `search "<query>" [--repo name]` (la même recherche depuis le shell).
5. Les deux tools ne sont exposés au LLM que si `getWorkspace()` est non-null (motif des tools
   conditionnels dans `src/codebuddy/tools.ts`/registry).

## Tests exigés (`tests/workspace/*.test.ts`)
- Config : résolution projet > user, entrées invalides ignorées (dossier absent, pas un git),
  realpath normalisé, env absente ⇒ null.
- `workspace_search` : deux repos git temporaires réels sur tmpdir avec contenus distincts ⇒
  résultats des deux préfixés ; filtre `repos:` ; borne max_results ; timeout (commande lente
  simulée si la mécanique le permet, sinon test du paramètre passé).
- `workspace_read` : lecture nominale ; traversal `../` ⇒ refus ; symlink pointant hors racine ⇒
  refus (crée un vrai symlink dans le tmpdir) ; fichier trop gros ⇒ refus ; repo inconnu ⇒ refus.
- Exposition conditionnelle : sans workspace ⇒ tools absents de la liste.
- CLI : motif Commander existant (add/rm/list round-trip sur tmpdir).

## Critères de done
- `npm run typecheck` : 0 erreur. Tests ciblés verts.
- Sans `CODEBUDDY_WORKSPACE` + workspace.json, rien ne change (tools non exposés).
- `docs/cb2/multi-repo.md` écrit. Commits `feat(workspace): …`.

## Interdits
- AUCUNE écriture dans les repos externes (tools read-only strict en P0).
- Pas d'indexation lourde / embeddings en P0 (grep only). Pas d'intégration Code Explorer en P0.
- Jamais de contenu au-delà des bornes (taille fichier, max_results) — l'agrégation cross-repo
  peut exploser le contexte sinon.
