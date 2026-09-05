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
| 2026-09-05 | Rapport créé. Réservation du chantier. HEAD `6f877e343`. |
| | *(suite au fil des commits)* |

## Tableau point → fichiers → tests rouge→vert → SHA

| Point | Fichiers | Tests rouge→vert | SHA |
|---|---|---|---|
| 0. Réservation | `docs/reports/2026-09/SURVEILLANCE-V2-GROK.md`, `docs/FABLE5-CODEX-COORDINATION.md` | — | *(à remplir)* |
| 1. Normalisation multi-cœur | *(à remplir)* | *(à remplir)* | *(à remplir)* |
| 2. Battement TS de repli | *(à remplir)* | *(à remplir)* | *(à remplir)* |
| 3. `buddy sensory status` | *(à remplir)* | *(à remplir)* | *(à remplir)* |
| Docs (tableau env + surveillance) | *(à remplir)* | — | *(à remplir)* |

## Preuves

*(commandes + sorties exactes, à remplir après chaque point)*

## Bilan (10 lignes max)

*(à remplir en fin de mission — faits seulement, pas de verdict)*
