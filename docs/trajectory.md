# Trajectory unifiée et taxonomie d'effet des outils

Lecture seule. Aucun journal nouveau. Pas d'opt-in.

## `buddy run trajectory <runId> [--json] [--since]`

Vue unique d'un run déjà enregistré. Sources lues, jamais écrites :

- RunStore (`buddy run list|show`) : événements `tool_call` / `tool_result`, métriques agrégées
- `src/security/audit-logger.ts` : JSONL `~/.codebuddy/audit-YYYY-MM-DD.jsonl` **si** le fichier existe
- `ModelRoutingFacade` : coût de session en mémoire — **non persisté**, annoncé `non journalisé`
- `src/sessions/timeline.ts` : uniquement si `CODEBUDDY_TIMELINE=true` et fichier présent
- `ConfirmationService` : décisions via l'audit (`confirmation_granted` / `confirmation_denied`)
- `rule-runs.jsonl` sensoriel : overlap temporel avec la fenêtre du run, pas une clé `runId`

`--since` : timestamp ISO-8601 ou epoch ms. JSON stable : `schemaVersion: 1`, `kind: "run_trajectory"`.

La fonction pure est `buildTrajectory(sources)` (`src/observability/run-trajectory.ts`). La CLI ne présente.

## Taxonomie C5 — `effect`

Chaque entrée de `TOOL_METADATA` déclare `effect: 'read' | 'reversible' | 'emission'` :

| Classe | Sens |
|---|---|
| `read` | Observation pure |
| `reversible` | Mutation annulable par CheckpointManager ou inverse connu |
| `emission` | Envoi irréversible : réseau, message, spawn, kill, écrasement du presse-papiers |

Un outil hors catalogue (MCP, authored) sans champ vaut `unknown` (avertissement unique, pas d'exception). `tool_search` et `buddy tools catalog` affichent la classe.

`buddy run trajectory-export` reste l'export rédigé pour evals (schéma v1 inchangé).
