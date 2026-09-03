# RAPPORT GK12 — `buddy autonomy` / `buddy colab` en vrai

**Agent :** Grok 4.6
**Clone :** `/home/patrice/DEV/cb-repar-executor-2026-09-02`
**Branche :** `fix/gk12-autonomy-reel-2026-09-03`
**HOME isolé :** `_qa/gk12-home` (`CODEBUDDY_HOME`, `CODEBUDDY_FLEET_COLAB_DIR`, `CODEBUDDY_RUNS_DIR`)
**Modèles :** Ollama local `qwen3:4b-instruct` et `qwen3.8:27b` — aucun appel payant (`whoami` : ChatGPT not connected).
**systemd :** non utilisé. Original `~/code-buddy` : non touché.

## Parcours réel (avant correctif)

| Commande | Attendu | Obtenu | Correctif | Commit |
|---|---|---|---|---|
| `buddy autonomy status --json` | queue vide, HOME isolé | `dir=_qa/gk12-home/fleet`, `tasks=[]` | — | — |
| `buddy colab status` | alias de `autonomy status` | alias OK | — | — |
| `buddy autonomy tasks add "<fix add.mjs>"` | tâche avec gate `node add.check.mjs` | tâche `open`, **aucun** `--verify-command` / `--files-to-modify` | flags CLI | `fix(autonomy): exposer la gate de preuve sur tasks add` |
| `buddy autonomy run --max-ticks 1` (défaut) | **ne pas** marquer done sans toucher le jouet | `completed: 1`, artifact `.md` correct, **`add.mjs` inchangé**, `node add.check.mjs` exit 1 | refuse `filesToModify`/`verifyCommand` | `fix(autonomy): ne plus terminer une tâche repo via un sidecar` |
| `buddy autonomy briefing` | relater la preuve, pas un succès inventé | « 1 tâche terminée » + artifact `.md` alors que le jouet est cassé | briefing passif (il lit le store) ; le store ne ment plus après le refuse | (même commit exécuteur) |
| `buddy autonomy bench` | ranger le modèle **local** | `ok:false` « No Tailnet Ollama peers were discovered » (3 peers Tailscale, Ollama local vivant) | inclure le palier local | `fix(autonomy): bench le Ollama local` |
| `buddy run list` | voir le tick autonomie | `No runs found` | journal `RunStore` | `fix(autonomy): journaliser les ticks dans buddy run` |
| `CODEBUDDY_AUTONOMY_EXECUTOR=agent` + 27b | corriger `add.mjs` | `failed` ETIMEDOUT 600 s, jouet inchangé, tâche `open` attempts=1 | `--executor agent --workspace --verify` + échec si fichiers listés inchangés | `fix(autonomy): échouer si filesToModify inchangés` |

## Preuves avant

- Jouet `_qa/gk12-jouet/` : 3 fichiers, `add.mjs` fait `a - b`. `node add.check.mjs` → `FAIL: add(2, 3) should be 5, got -1`.
- Artifact v0 (28 s, `$0`, `local/qwen3:4b-instruct`) a écrit `export function add(a, b) { return a + b; }` dans `_qa/gk12-home/fleet/out/task-….md` et a marqué la tâche **completed**.
- Agent 27b : 10 min 06, `spawnSync tsx ETIMEDOUT`, GPU occupée (autre mission `qwen3:4b-instruct`). Pas de diff jouet.
- `buddy colab --help` affiche l’aide racine ; `buddy colab status` fonctionne.

## Correctifs (test rouge → vert)

1. **CLI `tasks add`** : `--verify-command`, `--files-to-modify`, `--acceptance-criteria` (répétable).
2. **`autonomy run`** : `--executor artifact|agent`, `--workspace`, `--verify`. Agent sans workspace → exit 1.
3. **Exécuteur artifact** : refuse une tâche `filesToModify`/`verifyCommand` ; `sanitizeModelOutput` enlève `<think>`.
4. **Exécuteur agent** : hash SHA-256 des `filesToModify` avant/après ; zéro changement → `ok:false`.
5. **Bench** : candidat `local` (`CODEBUDDY_LOCAL_MODEL` + `OLLAMA_BASE_URL`) même sans Tailnet.
6. **Journal** : chaque `autonomy run` → `buddy run list` / `show` (coût `$0.000000` observé).

## Parcours réel (après correctif)

| Commande | Attendu | Obtenu |
|---|---|---|
| `tasks add … --verify-command 'node add.check.mjs' --files-to-modify add.mjs` | champs persistés | JSON : `verifyCommand`, `filesToModify`, `acceptanceCriteria` |
| `autonomy run --max-ticks 1` (artifact) | **failed**, jouet intact | `outcomes.failed=1`, détail « use the agent executor », `runId=run_mtlcjuer_f2fcc4` |
| `buddy run list` | tick visible | `[FAIL] run_mtlcjuer_f2fcc4 autonomy run` (9 ms, `$0`) |
| `buddy autonomy bench --models qwen3:4b --prompt-set latency` | local présent | `ok true`, 1 candidat `local qwen3:4b-instruct` |
| `buddy autonomy briefing` | 2 échecs visibles, 1 completed historique | 3 ticks, 2 failed, 0 payant |

Le tick agent `--executor agent --workspace _qa/gk12-jouet --verify` sur `qwen3:4b-instruct` : **8 min 44 s**, `failed: 1`, worklog `no change in filesToModify (add.mjs)`, jouet toujours `add(2,3)=-1`. La tâche a été **dead-lettered** (`blocked`, 3 tentatives). Le 27b avait déjà démontré un timeout 600 s sans diff. Aucune preuve positive « le modèle local a édité add.mjs » sur ce GPU aujourd’hui.

## Ouvert

- Ni `qwen3.8:27b` (ETIMEDOUT 600 s) ni `qwen3:4b-instruct` (8 min 44 s, `filesToModify` inchangés) n’ont corrigé le jouet. Pas de preuve positive « le modèle a édité add.mjs ».
- `buddy colab --help` reste l’aide racine Commander.
- Un run `headless prompt` resté `[RUNNING]` après le timeout 27b (fuite de journal, hors périmètre).
- Le completed historique (sidecar v0) reste dans la queue isolée GK12 ; le produit ne le réécrit pas.

## Tests

```
vitest run tests/commands/native-engine-commands.test.ts \
  tests/daemon/ollama-task-executor.test.ts \
  tests/daemon/agent-task-executor.test.ts \
  tests/daemon/autonomy-bench-candidates.test.ts \
  tests/daemon/autonomy-run-journal.test.ts \
  tests/daemon/autonomous-loop.test.ts \
  tests/daemon/autonomous-daemon.test.ts
```

165/165 verts après correctif (4 rouges avant sur les nouveaux cas).
