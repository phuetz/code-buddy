# RUNAWAY-REMEDIATION-GROK — action `kill_process` opt-in du moteur de règles

**Date** : 2026-09-05
**Agent** : Grok 4.6
**Dépôt** : `~/DEV/cb-heartwatch-2026-09-05` (clone ; original `~/code-buddy` interdit)
**Branche** : `grok/runaway-remediation-2026-09-05`
**HEAD de départ** : `c89051551` (`Merge branch 'grok/surveillance-ameliorations-2026-09-05' into codex/audit-systeme-nerveux-2026-09-01`)
**HOME Vitest** : `~/DEV/cb-heartwatch-2026-09-05/_qa/grok-kill/home` (gitignoré)
**Rapport créé avant inspection du code.**

Références à lire avant le code (après ce rapport) :
- `docs/surveillance-evenementielle.md`
- `docs/reports/2026-09/VERIFICATION-FIX-AGY.md` §4.1.1 (le besoin)
- `src/sensory/sensory-action-executor.ts` (actions `shell|webhook|alert|agent`, garde `isDestructive`)
- `src/sensory/sensory-rules-engine.ts` (plafonds, audit `rule-runs.jsonl`)
- `src/sensory/system-vitals-emitter.ts` (percept `process_runaway` : `pid`, `ppid`, `comm`, `pcpuTotal`, `etimeSec`, `scope`, `startTime` si présent)

Incident de référence (05/09) : trois `bash` à 99,9 % pendant 2 h 30, nés d'une session CLI, jamais tués. Le robot doit pouvoir s'auto-réparer, mais un `kill` automatique est dangereux : tout est BORNÉ.

## Objectif

Remédiation bornée, **opt-in, défaut OFF, byte-identique sans variable ni règle** (assert par test) :

1. **Action `kill_process`** dans l'exécuteur : n'accepte QUE le `pid` porté par le percept `process_runaway` qui a déclenché la règle (jamais un pid libre dans la règle) ; revérifie AVANT de tuer que le pid existe encore, que son `comm` et son `startTime` (`/proc/<pid>/stat` champ 22) sont ceux du percept (anti PID-reuse) ; que ce n'est ni le serveur lui-même, ni un ancêtre du serveur, ni pid 1, ni un process d'un autre uid ; `SIGTERM` puis, après `graceMs` (défaut 5000, borné 1000–60000), `SIGKILL` seulement si `escalate: true` ; jamais de pid négatif, jamais de groupe. Option `dryRun` (défaut true) qui journalise sans tuer — un `kill` réel exige `dryRun:false` dans la règle ET `CODEBUDDY_RUNAWAY_KILL=true` côté serveur (double opt-in). `isDestructive`/`validateRule` : une règle `kill_process` sans `dryRun:false` est acceptée ; une règle `kill_process` dont `match.kind` n'est pas `process_runaway` est REFUSÉE à l'enregistrement.
2. **Percept de remédiation** : après action, émettre `sensory:perception` `{modality:'system', kind:'process_remediated', payload:{pid, comm, signal, dryRun, ok, reason}}`. Gabarit `process-runaway-kill` dans `rule-templates.ts` (`dryRun:true` par défaut, cooldown 60 s, `escalate:false`) et `buddy rules add --template process-runaway-kill`.
3. **Tests rouge→vert** (`tests/sensory/`) : pid absent → no-op journalisé ; comm différent → refus ; startTime différent → refus ; pid = `process.pid` ou ancêtre → refus ; dryRun → aucun `process.kill` (spy) ; double opt-in : sans env, `dryRun:false` reste un dry-run avec `reason:'CODEBUDDY_RUNAWAY_KILL unset'` ; avec env + `dryRun:false` → `process.kill(pid,'SIGTERM')` puis SIGKILL après `graceMs` (fake timers) si escalate ; `validateRule` refuse le mauvais `match.kind` ; sans variable ni règle, comportement byte-identique.

Aucun push. `git add` fichier par fichier. Ne pas rédiger de verdict (le pilote le fera).

## Invariants

- Défaut OFF ⇒ aucun comportement nouveau sans variable ni règle (assert par test).
- Jamais `git add -A` / `git commit -a` / `git push` / `git reset --hard` / `rm -rf`.
- Ne pas écrire dans `~/code-buddy` ni `~/.codebuddy`.
- Ne pas toucher ComfyUI 8188/8189 ni les services en cours.
- `_qa/agy-v2/` et `_qa/verify/` (non suivis, hors mission) ne sont pas touchés.
- Jamais `/home/<user>` dans les fichiers suivis ; écrire `~`.
- HOME isolé : `HOME=$PWD/_qa/grok-kill/home` + `env -u FORCE_COLOR`.

## Journal

| Heure | Action |
|---|---|
| 2026-09-05 | Rapport créé. Réservation du chantier. HEAD de départ `c89051551`. |

## Tableau point → fichiers → tests rouge→vert → SHA

| Point | Fichiers | Tests rouge→vert | SHA |
|---|---|---|---|
| 0. Réservation | `docs/reports/2026-09/RUNAWAY-REMEDIATION-GROK.md`, `docs/FABLE5-CODEX-COORDINATION.md`, `.gitignore` (`_qa/grok-kill/`) | — | *(à remplir)* |
| 1. Action `kill_process` | *(à remplir)* | *(à remplir)* | *(à remplir)* |
| 2. Percept `process_remediated` + gabarit | *(à remplir)* | *(à remplir)* | *(à remplir)* |
| 3. Tests restants + docs | *(à remplir)* | *(à remplir)* | *(à remplir)* |

## Preuves

*(à remplir après les commandes demandées)*

- `HOME=$PWD/_qa/grok-kill/home env -u FORCE_COLOR npx vitest run tests/sensory tests/cli` — compte exact
- `npx tsc --noEmit -p tsconfig.json | tail -2`
- eslint ciblé 0
- `git diff --check`
- `tests/security/donnees-personnelles.test.ts` vert

## Bilan (≤ 10 lignes)

*(à remplir en fin de mission, sans verdict)*
