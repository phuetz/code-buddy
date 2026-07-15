# SPEC-CB2 — INNOV-5 : Self-Benchmark continu (le produit qui se mesure)

Tu travailles dans un worktree git du repo **Code Buddy** (agent de codage IA multi-provider,
TypeScript strict ESM, tests Vitest). Branche : `cb2/self-benchmark`. Campagne « Code Buddy 2 ».

## Règles du repo (OBLIGATOIRES)
- Imports relatifs avec extension `.js` même depuis des `.ts`. Pas de `any`. `noUncheckedIndexedAccess` ON.
- `logger` (`src/utils/logger.js`) en production, jamais `console.*` (sauf sortie CLI dans `src/commands/`).
- Fichiers kebab-case ; tests UNIQUEMENT sous `tests/` : `npm test -- tests/<fichier>`.
- Feature OPT-IN (`CODEBUDDY_SELF_BENCH=true`), CLI-only en P0 — défaut ⇒ ZÉRO changement.
- Conventional Commits. Avant chaque commit : `npm run typecheck` (0 erreur) + tes tests ciblés verts.
  N'exécute PAS la suite complète. `npm install --no-audit --no-fund` si node_modules manque.
- Ne commite jamais : SPEC-CB2.md, node_modules, état `.codebuddy/`.
- Documente dans `docs/cb2/self-benchmark.md`. NE MODIFIE PAS CLAUDE.md.

## Mission
Code Buddy se mesure lui-même dans le temps : un banc de scénarios déterministe score chaque
modèle/provider actif, historise les scores (JSONL), **détecte les régressions de capacité**
(un modèle mis à jour côté provider qui devient plus faible, un endpoint dégradé) et alimente le
ModelScoreboard pour que le routage s'adapte. « Le seul agent qui sait quand il devient plus bête. »

## Ancrage dans l'existant (à lire d'abord)
- `src/agent/self-improvement/capability-benchmark.ts` — le banc déterministe existant (utilisé
  par la boucle lessons). RÉUTILISE ses scénarios et son scoring ; n'invente pas un nouveau banc.
- `src/providers/active-llm-model-pool.ts` — l'énumération des modèles actifs par provider
  (utilisée par le council en mode `full`).
- Le ModelScoreboard du council (ledger JSONL `~/.codebuddy/fleet-model-performance.jsonl`) —
  trouve son API d'écriture dans `src/council/` et appends-y des runs `benchmark` via l'API
  existante (ne réinvente pas le format ; si le format exige des champs de run council, ajoute un
  type d'entrée dédié compatible).
- `src/fleet/model-selector.ts` — consommateur de latence mesurée (contexte).

## Périmètre P0
1. `src/agent/self-improvement/continuous-benchmark.ts` :
   - `runBenchmark(opts)` : énumère les modèles actifs (pool existant, filtrable par
     `--models a,b` / `--provider p`), exécute le capability-benchmark sur chacun (client LLM
     injectable pour les tests), avec timeout par scénario (`CODEBUDDY_SELF_BENCH_TIMEOUT_MS`,
     défaut 60000) et budget de scénarios (`--scenarios N`, défaut tous).
   - Historisation : append par (modèle, scénario, score, latenceMs, ts, benchVersion) dans
     `~/.codebuddy/capability-history.jsonl`.
   - `detectRegressions(history)` (PURE, testable) : pour chaque modèle, compare le dernier score
     agrégé à la moyenne mobile des N derniers runs (N=5) ; régression si chute > seuil
     (`CODEBUDDY_SELF_BENCH_DROP`, défaut 0.15 relatif). Retourne la liste
     `{model, before, after, drop}`.
   - Alimentation scoreboard : chaque run écrit aussi une entrée scoreboard (API existante) pour
     que le routage council/voice profite des mesures.
2. CLI `buddy improve bench` (étend `src/commands/improve.ts` ou équivalent — trouve où
   `improve status|cycle|tools|skills` sont déclarés) :
   - `--run` (exécute), `--history [model]` (courbe ASCII simple par run), `--report` (dernier
     état : score par modèle, régressions détectées, recommandation).
   - Gardé fail-closed par `CODEBUDDY_SELF_BENCH=true` (sinon message + exit 1).
3. PAS de scheduling automatique en P0 (pas de câblage heartbeat/autonomous-loop) — CLI-only.

## Tests exigés (`tests/self-improvement/continuous-benchmark.test.ts`)
- `detectRegressions` : cas nominal, chute franche détectée, bruit sous le seuil ignoré,
  historique insuffisant (<2 runs) ⇒ pas de verdict.
- `runBenchmark` avec client LLM mocké : historisation JSONL correcte (tmpdir via env override du
  chemin — ajoute `CODEBUDDY_SELF_BENCH_HISTORY` pour ça), timeout par scénario, filtre `--models`.
- Scoreboard : l'entrée est écrite via l'API existante (spy/mock), format accepté par son parseur.
- CLI : motif Commander existant ; sans env var ⇒ exit 1.

## Critères de done
- `npm run typecheck` : 0 erreur. Tests ciblés verts.
- Sans `CODEBUDDY_SELF_BENCH`, rien ne change nulle part.
- `docs/cb2/self-benchmark.md` écrit. Commits `feat(self-improvement): …`.

## Interdits
- Ne modifie NI les scénarios du capability-benchmark NI le format du scoreboard existant.
- Aucun appel LLM réel dans les tests. Aucun scheduling automatique en P0.
