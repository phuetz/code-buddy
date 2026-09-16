# SURVEILLANCE-V2-GROK — trois améliorations de la feuille de route

**Date** : 2026-09-05
**Agent** : Grok 4.6
**Dépôt** : `~/DEV/cb-heartwatch-2026-09-05` (clone ; original `~/code-buddy` interdit)
**Branche** : `grok/surveillance-ameliorations-2026-09-05`
**HEAD de départ** : `6f877e343` (`docs(heartwatch): rapports de vérification agy (PUSHABLE + feuille de route) et MiniMax (CPU delta, 1 défaut mineur)`)
**HOME Vitest** : `~/DEV/cb-heartwatch-2026-09-05/_qa/grok-v2/home` (gitignoré)
**Rapport créé avant inspection du code.**

Références lues avant le code :
- `docs/surveillance-evenementielle.md`
- `docs/reports/2026-09/VERIFICATION-FIX-AGY.md` §4 (feuille de route)
- `docs/reports/2026-09/VERIF-VITALS-GMI.md` (défaut 3 : payload multi-cœur)

## Objectif

Trois améliorations **opt-in, défaut OFF, byte-identique sans variable** (assert par test) :

1. **Normalisation multi-cœur** (`src/sensory/system-vitals-emitter.ts`) — payload `process_runaway` : `pcpuTotal`, `pcpuOfMachine`, `cores` ; seuil `CODEBUDDY_RUNAWAY_CPU_PCT` reste sur `pcpuTotal` ; `CODEBUDDY_RUNAWAY_CPU_BASIS=core|machine` (défaut `core`).
2. **Battement TS de repli** — pacemaker `setInterval` opt-in `CODEBUDDY_HEARTBEAT_FALLBACK=true` (période `CODEBUDDY_HEARTBEAT_FALLBACK_MS`, défaut 1000) émettant `vital/heartbeat` ; désactivé dès qu’un battement réel arrive, réactivé après `CODEBUDDY_HEARTBEAT_FALLBACK_SILENCE_MS` (défaut 15000) de silence ; jamais deux horloges ; `unref()` ; teardown serveur.
3. **`buddy sensory status`** — lecture seule, flags, source du battement, cadence des traitements, 5 dernières perceptions `system`/`time`, règles + derniers déclenchements ; serveur absent dit clairement ; `--json`.

Aucun push. `git add` fichier par fichier. Ne pas rédiger de verdict (le pilote le fera).

## Invariants

- Défaut OFF ⇒ aucun comportement nouveau sans variable (assert par test).
- Jamais `git add -A` / `git commit -a` / `git push` / `git reset --hard` / `rm -rf`.
- Ne pas écrire dans `~/code-buddy` ni `~/.codebuddy`.
- Ne pas toucher ComfyUI 8188/8189 ni les services en cours.
- `_qa/verify/` (non suivi, hors mission) n’est pas touché.

## Journal

| Heure | Action |
|---|---|
| 2026-09-05 | Rapport créé. Réservation du chantier. HEAD de départ `6f877e343`. |
| 2026-09-05 | Point 1 : payload multi-cœur + `CODEBUDDY_RUNAWAY_CPU_BASIS`. Rouge 4/22 → vert 22/22. SHA `f31004d6f`. |
| 2026-09-05 | Point 2 : pacemaker TS `heartbeat-fallback.ts`, teardown `src/server/index.ts`. 5 tests verts (timers factices). SHA `62ef2559d`. |
| 2026-09-05 | Point 3 : `buddy sensory status [--json]`. 9 tests verts (7 CLI + 2 snapshot). SHA `1de88f026`. |
| 2026-09-05 | Docs `CLAUDE.md` + `docs/surveillance-evenementielle.md`. Suite `tests/sensory`+`tests/cli` 867 verts. |

## Tableau point → fichiers → tests rouge→vert → SHA

| Point | Fichiers | Tests rouge→vert | SHA |
|---|---|---|---|
| 0. Réservation | `docs/reports/2026-09/SURVEILLANCE-V2-GROK.md`, `docs/FABLE5-CODEX-COORDINATION.md`, `.gitignore` (`_qa/grok-v2/`) | — | `92639260c909c0bff68d3828ad53f12087912d29` |
| 1. Normalisation multi-cœur | `src/sensory/system-vitals-emitter.ts`, `tests/sensory/system-vitals-emitter.test.ts` | 4 nouveaux tests **ROUGE** (18 pass / 4 fail) sur l’ancien émetteur ; **VERT** 22/22 après correctif. Faux `/proc` (ProcSample injecté) 4 cœurs, 350 % → `pcpuOfMachine` 87,5 ; runaway en `core` ; pas en `machine` seuil 90. Défaut unset = encore runaway à 100 % sur 8 cœurs (byte-identique). | `f31004d6f783a0e5498c6a02c994e5b38dc73e1f` |
| 2. Battement TS de repli | `src/sensory/heartbeat-fallback.ts` (nouveau), `src/server/index.ts` (teardown), `tests/sensory/heartbeat-fallback.test.ts` | 5/5 verts. Env unset → 0 beat après 30 s (byte-identique). `vi.useFakeTimers` : réel→repli→réel, jamais deux sources au même timestamp. `unref()` + `stop()`. Scheduler existant 7/7 inchangé. | `62ef2559d24924ebe9981f6499e2e668cdf0718d` |
| 3. `buddy sensory status` | `src/sensory/sensory-status.ts`, `src/commands/cli/sensory-command.ts`, `src/index.ts`, `src/server/index.ts`, `tests/cli/sensory-status.test.ts`, `tests/sensory/sensory-status.test.ts` | 9/9 verts. Commander `parseAsync` + `exitOverride`. Sans fichier d’état → « serveur non joignable ». Snapshot pid vivant / mort, flags, rust/fallback, traitements, 5 percepts, règles + `rule-runs.jsonl`. `--json`. | `1de88f026846a616f16de8524cc0168d6f35c02f` |
| Docs | `CLAUDE.md` (tableau env), `docs/surveillance-evenementielle.md` | — | `f18eaf307c131f1d048d7da7ba5000da84185474` |

## Preuves

### Point 1 (isolé)

```text
# ROUGE (émetteur HEAD, tests nouveaux)
HOME=$PWD/_qa/grok-v2/home npx vitest run tests/sensory/system-vitals-emitter.test.ts
# Test Files  1 failed (1)
# Tests       4 failed | 18 passed (22)

# VERT (émetteur patché)
# Test Files  1 passed (1)
# Tests       22 passed (22)
```

### Point 2 (isolé)

```text
HOME=$PWD/_qa/grok-v2/home npx vitest run tests/sensory/heartbeat-fallback.test.ts tests/sensory/heartbeat-scheduler.test.ts
# Test Files  2 passed (2)
# Tests       12 passed (12)
```

### Point 3 (isolé)

```text
HOME=$PWD/_qa/grok-v2/home npx vitest run tests/cli/sensory-status.test.ts tests/sensory/sensory-status.test.ts
# Test Files  2 passed (2)
# Tests       9 passed (9)
```

### Suite demandée

```text
env -u FORCE_COLOR HOME=$PWD/_qa/grok-v2/home npx vitest run tests/sensory tests/cli
# Test Files  98 passed | 1 skipped (99)
# Tests       867 passed | 4 skipped | 1 todo (872)
# Duration    97.27s
# exit 0
```

Note d’environnement : le premier passage **avec** `FORCE_COLOR` (session) a fait échouer `tests/cli/help-output.test.ts` 6/6 (`stderr` = warning Node « NO_COLOR ignored due to FORCE_COLOR »). Rejeu `env -u FORCE_COLOR` : 6/6 verts. Pas un défaut du code de cette mission.

```text
npx tsc --noEmit -p tsconfig.json | tail -2
# (aucune ligne tsc)  TSC_EXIT=0

npx eslint src/sensory/system-vitals-emitter.ts src/sensory/heartbeat-fallback.ts \
  src/sensory/sensory-status.ts src/commands/cli/sensory-command.ts src/index.ts \
  src/server/index.ts tests/sensory/system-vitals-emitter.test.ts \
  tests/sensory/heartbeat-fallback.test.ts tests/sensory/sensory-status.test.ts \
  tests/cli/sensory-status.test.ts --max-warnings=0
# ESLINT_EXIT=0

git diff --check
# DIFF_CHECK=0
```

Aucun `git push`. `_qa/verify/` (préexistant, non suivi) non touché. ComfyUI 8188/8189 non touchés. `~/code-buddy` et `~/.codebuddy` non écrits.

## Bilan (10 lignes max)

1. Point 1 : payload `process_runaway` enrichi (`pcpuTotal`, `pcpuOfMachine`, `cores`) ; seuil toujours sur `pcpuTotal` ; `CODEBUDDY_RUNAWAY_CPU_BASIS=machine` optionnel (défaut `core`).
2. Preuve 1 : 350 % / 4 cœurs → 87,5 ; runaway en `core`, pas en `machine` à 90 ; 4 tests rouge→vert, 22/22.
3. Point 2 : pacemaker TS opt-in, même percept `vital/heartbeat`, coupé par un beat réel, réarmé après 15 s, `unref()`, teardown serveur.
4. Preuve 2 : timers factices, bascule réel↔repli, jamais deux sources au même instant ; env unset = 0 beat.
5. Point 3 : `buddy sensory status [--json]` lecture seule (flags, source rust/fallback/aucun, traitements, 5 percepts, règles + jsonl).
6. Preuve 3 : 9/9 Commander `parseAsync`+`exitOverride` ; « serveur non joignable » sans fichier d’état.
7. Suite `tests/sensory`+`tests/cli` : 98 fichiers / 867 tests verts (`env -u FORCE_COLOR`, HOME `_qa/grok-v2/home`).
8. `tsc --noEmit` 0 ; ESLint ciblé 0 ; `git diff --check` 0.
9. Docs : tableau env `CLAUDE.md` + `docs/surveillance-evenementielle.md` (basis, fallback, CLI, cadence tick 20).
10. Ouvert : le pilote tranche le merge ; pas de `kill_process` auto (hors périmètre §4.1.1) ; help-output sensible à `FORCE_COLOR`+`NO_COLOR` dans cette session.
