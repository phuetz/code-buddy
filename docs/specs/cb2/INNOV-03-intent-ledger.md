# SPEC-CB2 — INNOV-3 : Intent Ledger (la spec vivante)

Tu travailles dans un worktree git du repo **Code Buddy** (agent de codage IA multi-provider,
TypeScript strict ESM, tests Vitest). Branche : `cb2/intent-ledger`. Campagne « Code Buddy 2 ».

## Règles du repo (OBLIGATOIRES)
- Imports relatifs avec extension `.js` même depuis des `.ts`. Pas de `any`. `noUncheckedIndexedAccess` ON.
- `logger` (`src/utils/logger.js`) en production, jamais `console.*` (sauf sortie CLI dans `src/commands/`).
- Fichiers kebab-case ; tests UNIQUEMENT sous `tests/` : `npm test -- tests/<fichier>`.
- Feature OPT-IN (`CODEBUDDY_INTENTS=true`), CLI-only en P0 (comme `buddy science`) — défaut ⇒ ZÉRO
  changement de comportement. Fail-closed sur les gates, never-throws ailleurs.
- Conventional Commits. Avant chaque commit : `npm run typecheck` (0 erreur) + tes tests ciblés verts.
  N'exécute PAS la suite complète. `npm install --no-audit --no-fund` si node_modules manque.
- Ne commite jamais : SPEC-CB2.md, node_modules, état `.codebuddy/`.
- Documente dans `docs/cb2/intent-ledger.md`. NE MODIFIE PAS CLAUDE.md.

## Mission
Toute tâche non triviale peut être capturée comme une **spec falsifiable versionnée** (un
« intent ») qui vit avec le code : objectif, critères VÉRIFIABLES (commandes shell dont l'exit
code fait foi), fichiers concernés. `buddy intents check` rejoue les critères ; `buddy intents
drift` détecte la dérive code↔spec. Le « done » devient un contrat re-vérifiable des mois plus tard.

## Ancrage dans l'existant (à lire d'abord)
- `src/agent/dev-loop/dev-loop.ts` — le motif « critères vérifiables + Verifier gate » existe déjà
  (`--verify-cmd`, `makeShellVerifier`) : REPREND ce vocabulaire et ce style.
- `src/agent/film/scene-planner.ts` — le motif « LLM one-shot JSON via `resolveCommandProvider` +
  `CodeBuddyClient` + `generateJsonWithRetry` » : c'est le motif à réutiliser pour générer un
  intent depuis une description en langage naturel.
- `buddy science` (`src/commands/`) — le motif CLI-only fail-closed opt-in.

## Périmètre P0
1. `src/intents/intent-store.ts` :
   - Un intent = un fichier Markdown avec frontmatter YAML sous `.codebuddy/intents/<id>.md` :
     `{id, title, status: active|done|archived, createdAt, files: string[],
     criteria: {desc, cmd, expectExit: number}[]}` + corps libre (contexte, décisions).
   - Index JSONL append-only `.codebuddy/intents/ledger.jsonl` (événements created/checked/drifted/
     archived — audit trail).
   - CRUD : `create`, `get`, `list`, `setStatus`. Parsing frontmatter robuste (réutilise la lib
     YAML déjà présente dans les deps du repo).
2. `src/intents/intent-generator.ts` : `generateIntent(description: string)` — LLM one-shot JSON
   (motif scene-planner) qui transforme une description de tâche en intent : titre, critères
   vérifiables sous forme de commandes shell (ex. `npm test -- tests/x.test.ts`, `grep -q …`),
   fichiers probables. Provider résolu via le mécanisme existant ; erreur LLM ⇒ message clair,
   jamais de crash.
3. `src/intents/intent-checker.ts` : `checkIntent(intent)` — exécute chaque critère (child_process
   injectable, timeout `CODEBUDDY_INTENTS_TIMEOUT_MS` défaut 120000, cwd = racine repo), retourne
   `{criterion, ok, exitCode, tail}` par critère + verdict global. `drift(store)` — pour chaque
   intent `done` : critères re-passés ? fichiers référencés toujours existants ? ⇒ liste des
   intents en dérive.
4. CLI `buddy intents` (nouveau `src/commands/intents.ts`, lazy-loadé depuis `src/index.ts`,
   gardé fail-closed par `CODEBUDDY_INTENTS=true` — sinon message d'aide et exit 1) :
   - `new "<description>"` (génère via LLM, écrit le fichier, affiche l'id)
   - `list` / `show <id>` / `check <id>` / `drift` / `done <id>` / `archive <id>`.

## Tests exigés (`tests/intents/*.test.ts`)
- Store : create/get/list/setStatus sur tmpdir, frontmatter round-trip, ledger append.
- Checker : critères avec `sh -c "exit 0/1"` injectés, timeout, verdict global AND, drift
  (fichier supprimé ⇒ dérive ; critère qui échoue ⇒ dérive).
- Generator : client LLM mocké (réponse JSON valide + réponse invalide ⇒ retry puis erreur propre).
- CLI : motif Commander existant (parseAsync + exitOverride + mocks) ; sans env var ⇒ exit 1.

## Critères de done
- `npm run typecheck` : 0 erreur. Tests ciblés verts.
- Sans `CODEBUDDY_INTENTS`, rien ne change (le module n'est même pas importé par le chemin chaud).
- `docs/cb2/intent-ledger.md` écrit. Commits Conventional (`feat(intents): …`).

## Interdits
- Pas de câblage dans le dev-loop ni dans l'agent en P0 (CLI-only).
- Les commandes des critères s'exécutent SANS shell interactif ni sudo, timeout obligatoire.
- Ne touche pas à `src/agent/dev-loop/` (lecture seule, motif uniquement).
