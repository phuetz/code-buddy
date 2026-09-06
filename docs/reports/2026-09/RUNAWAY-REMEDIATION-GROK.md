# RUNAWAY-REMEDIATION-GROK — action `kill_process` opt-in du moteur de règles

**Date** : 2026-09-05
**Agent** : Grok 4.6
**Dépôt** : `~/DEV/cb-heartwatch-2026-09-05` (clone ; original `~/code-buddy` interdit)
**Branche** : `grok/runaway-remediation-2026-09-05`
**HEAD de départ** : `c89051551` (`Merge branch 'grok/surveillance-ameliorations-2026-09-05' into codex/audit-systeme-nerveux-2026-09-01`)
**HOME Vitest** : `~/DEV/cb-heartwatch-2026-09-05/_qa/grok-kill/home` (gitignoré)
**Rapport créé avant inspection du code.**

Références lues après ce rapport :
- `docs/surveillance-evenementielle.md`
- `docs/reports/2026-09/VERIFICATION-FIX-AGY.md` §4.1.1
- `src/sensory/sensory-action-executor.ts`
- `src/sensory/sensory-rules-engine.ts`
- `src/sensory/system-vitals-emitter.ts`

Incident de référence (05/09) : trois `bash` à 99,9 % pendant 2 h 30, nés d'une session CLI, jamais tués.

## Objectif

Remédiation bornée, opt-in, défaut OFF, byte-identique sans variable ni règle.

## Invariants

- Défaut OFF ⇒ aucun `process.kill` sans `dryRun:false` **et** `CODEBUDDY_RUNAWAY_KILL=true`.
- Jamais `git add -A` / `git commit -a` / `git push` / `git reset --hard` / `rm -rf`.
- Ne pas écrire dans `~/code-buddy` ni `~/.codebuddy`.
- Ne pas toucher ComfyUI 8188/8189.
- Jamais `/home/<user>` dans les fichiers suivis ; écrire `~`.
- HOME isolé : `HOME=$PWD/_qa/grok-kill/home` + `env -u FORCE_COLOR`.

## Journal

| Heure | Action |
|---|---|
| 2026-09-05 | Rapport créé. Réservation. HEAD de départ `c89051551`. SHA `d3322ce22`. |
| 2026-09-05 | Point 1 : action `kill_process` + `validateRule` + `startTime` dans le percept. Tests 20/20 **ROUGE** (unknown action type) → **VERT**. SHA `06c287c9b`. |
| 2026-09-05 | Point 2 : gabarit `process-runaway-kill`. SHA `080117da5`. |
| 2026-09-05 | Point 3 : docs + env `CODEBUDDY_RUNAWAY_KILL` + eslint unused-var. Suite sensory+cli. |

## Tableau point → fichiers → tests rouge→vert → SHA

| Point | Fichiers | Tests rouge→vert | SHA |
|---|---|---|---|
| 0. Réservation | `docs/reports/2026-09/RUNAWAY-REMEDIATION-GROK.md`, `docs/FABLE5-CODEX-COORDINATION.md`, `.gitignore` (`_qa/grok-kill/`) | — | `d3322ce22a574084b30a618f8da7557864d16bee` |
| 1. Action `kill_process` | `src/sensory/sensory-action-executor.ts`, `src/sensory/sensory-rules-engine.ts`, `src/sensory/system-vitals-emitter.ts` (`startTime` dans le payload), `tests/sensory/kill-process-action.test.ts`, assertion `startTime` dans `tests/sensory/system-vitals-emitter.test.ts` | **ROUGE** 20/20 (`unknown action type`) ; **VERT** 20/20. Pid absent / comm / startTime / self / ancêtre / pid 1 / autre uid / pid négatif / pid de la règle ignoré / dryRun / double opt-in / SIGTERM+SIGKILL (fake timers) / `process_remediated` / byte-identique shell / `validateRule`. | `06c287c9b4114c94cebef6984dcdd7dc837fc42d` |
| 2. Gabarit | `src/sensory/rule-templates.ts`, `tests/sensory/rule-templates.test.ts` | Gabarit `process-runaway-kill` : `dryRun:true`, `escalate:false`, cooldown 60 s, pas de pid, `validateRule` ok. `buddy rules add --template process-runaway-kill` (chemin générique existant). | `080117da5e5d386313a05c415d3e8d1f2bb63a51` |
| 3. Docs | `docs/surveillance-evenementielle.md`, `CLAUDE.md` (`CODEBUDDY_RUNAWAY_KILL`), rapport, coordination | — | `084b512b16c45c870b11ab0af1d854fbcfc63971` |

## Preuves

```text
# ROUGE (HEAD avant l'action, tests nouveaux)
HOME=$PWD/_qa/grok-kill/home env -u FORCE_COLOR npx vitest run tests/sensory/kill-process-action.test.ts
# Test Files  1 failed (1)
# Tests       20 failed (20)
# detail: "unknown action type"

# VERT (exécuteur + validateRule)
HOME=$PWD/_qa/grok-kill/home env -u FORCE_COLOR npx vitest run tests/sensory/kill-process-action.test.ts
# Test Files  1 passed (1)
# Tests       20 passed (20)

# Suite demandée
HOME=$PWD/_qa/grok-kill/home env -u FORCE_COLOR npx vitest run tests/sensory tests/cli
# Test Files  100 passed | 1 skipped (101)
# Tests       891 passed | 4 skipped | 1 todo (896)
# Duration    101.00s

env -u FORCE_COLOR npx tsc --noEmit -p tsconfig.json
# exit 0 (aucune ligne)

env -u FORCE_COLOR npx eslint --max-warnings=0 \
  src/sensory/sensory-action-executor.ts \
  src/sensory/sensory-rules-engine.ts \
  src/sensory/system-vitals-emitter.ts \
  src/sensory/rule-templates.ts \
  tests/sensory/kill-process-action.test.ts \
  tests/sensory/rule-templates.test.ts \
  tests/sensory/system-vitals-emitter.test.ts
# exit 0

git diff --check
# OK

HOME=$PWD/_qa/grok-kill/home env -u FORCE_COLOR npx vitest run tests/security/donnees-personnelles.test.ts
# Test Files  1 passed (1)
# Tests       40 passed (40)
```

## Bilan (≤ 10 lignes)

Action `kill_process` dans l'exécuteur : pid uniquement depuis le percept `process_runaway`, relecture `/proc` (`comm` + `startTime` champ 22), refus self/ancêtre/pid 1/autre uid/pid ≤ 0, jamais de groupe.
Double opt-in : `dryRun` défaut true ; un signal exige `dryRun:false` **et** `CODEBUDDY_RUNAWAY_KILL=true`.
`validateRule` accepte le dry-run et refuse un `match.kind` autre que `process_runaway` ou un pid dans la règle.
Après action : percept `process_remediated` ; gabarit `process-runaway-kill` (dryRun true, escalate false, cooldown 60 s).
Tests 20/20 rouge→vert ; suite `tests/sensory`+`tests/cli` 100 fichiers / 891 verts ; `tsc` 0 ; eslint ciblé 0 ; `git diff --check` 0 ; `donnees-personnelles` 40/40.
Aucun push. `~/code-buddy` et `~/.codebuddy` non touchés.
