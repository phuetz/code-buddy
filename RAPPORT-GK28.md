# RAPPORT-GK28 — `buddy cost`, `buddy run list|show|tail|replay`, `buddy changelog`, `buddy explain`, `buddy import` en vrai

Date : 2026-09-03 (Europe/Paris)
Agent : Grok 4.6
Clone : `~/DEV/cb-repar-catalogue-2026-09-02`
Branche : `fix/gk28-analytics-reel-2026-09-03`
HEAD au départ : `5e7639b42` (`Merge GK22 …`)
HEAD produit : `999137f79`
Original `~/code-buddy` : interdit (jamais ouvert, jamais écrit)
Rapport créé **avant toute inspection** (réservation `35029d32c`).
Buddy invoqué depuis le clone : `_qa/gk28/buddy.sh` → `node_modules/.bin/tsx src/index.ts`
HOME temporaire : `_qa/gk28/home`. Aucune écriture dans le vrai `~/.codebuddy`.
Ollama : `qwen3:4b-instruct` sur `127.0.0.1:11434`. `whoami` : ChatGPT not connected.

## Mission

Éprouver **pour de vrai** : tours headless Ollama $0 → `buddy cost` → `buddy run list|show|tail|replay` → `buddy changelog` (tags factices) → `buddy explain` (3 affirmations) → `buddy import` (`.mcp.json` + `settings.json`). Chaque défaut : test rouge → correctif → vert, un commit.

## Garde-fous

- Aucun `git push`, `git prune`, `git reset --hard`, `rm -rf`, `git add -A`, `git commit -a`.
- Aucune API payante. ComfyUI 8188/8189 non touché. Aucun service systemd.
- `package-lock.json` retouché par `npm install --ignore-scripts` puis restauré (`git checkout -- package-lock.json`).

## Journal

### 2026-09-03 — création du rapport (avant inspection)

HEAD `5e7639b42`. Arbre propre. Réservation `35029d32c`.

### Inspection (après réservation)

Surface réelle : `src/commands/{cost,changelog,explain,import}.ts`, `src/commands/run-cli/index.ts`, `src/analytics/{cost-report,repo-explainer}.ts`, `src/observability/{run-store,run-viewer}.ts`, `src/git/changelog.ts`.

### Parcours réel (avant correctifs)

**Tours headless** (`CODEBUDDY_PROVIDER=ollama`, `GROK_MODEL=qwen3:4b-instruct`, HOME isolé) :

- Tour 1 (161 s, exit 0) : `view_file src/ledger.js` + `HARVEST.md`. Réponse : `NIMBUS_LEDGER_MARK=7f3a` / `postEntry, balanceOf` / `no`. JSON `cost.total: 0`. Session `session_mtleh5gi_r315hb` **sans** tokens. Run `run_mtleh5jb_03224f` metrics `toolCallCount: 0` malgré 2 appels.

**`buddy cost`** : 1 session, 1 tour, `$0.0000`, **0 in / 0 out**, « Coût inconnu : 1 tour », modèle `qwen3:4b-instruct`, provider `ollama`.

**`buddy run list|show`** : `[DONE] run_mtleh5jb_03224f` 2m31s. Show : Tokens 0, Tool calls 0, timeline `view_file` réelle.

**`buddy run replay`** du tour 1 : timeline puis `No test steps found in this run.` — aucun effet.

**`buddy run tail`** (writer `RunStore` + CLI) : suit `run_mtlent5e_74b037` en cours, affiche `GK28-TAIL-MARKER` puis `run_end`. **Conforme.** Doc `tail [--follow]` fausse.

**`buddy changelog`** dans `_qa/gk28/changelog-repo` (tags `v0.1.0` / `v0.2.0`) : plage `v0.2.0 → HEAD`, 2 commits seulement (`feat(cli): print harvest marker 7f3a`, `fix(cli): do not invent a vineyard account`). **N’invente pas.**

**`buddy explain`** du jouet : 6 fichiers, 2 source, 1 test, marqueur `NIMBUS_LEDGER_MARK=7f3a`, `src/index.js`. **Inventait TypeScript** (0 fichier `.ts`) à cause du profileur `package.json` → TypeScript+JavaScript.

**`buddy import`** : `.mcp.json` fusionné (`nimbus-portable` importé, `existing-keep` conservé, `CODEBUDDY.md` non écrasé). **`.claude/settings.json` et `settings.json` ignorés en silence.**

### Défauts, rouge → vert

| Id | Défaut | Rouge | Commit |
|---|---|---|---|
| D1 | Session JSON sans tokens → cost « inconnu » / 0 in 0 out | `attachUsageToCurrentSession is not a function` | `986122b5d` |
| D2 | `toolCallCount` toujours 0 | attendu 2, obtenu 0 | `b183ce2b4` + null-check `999137f79` |
| D3 | Replay no-op hors bash test | `No test steps found` sur `view_file` | `0fc23c5c3` |
| D4 | Import ignore `settings.json` | importés 1, attendu 3 | `f24e8f14b` |
| D5 | Explain invente TypeScript | `['JavaScript','TypeScript']` | `461a66a12` |
| D6 | Doc `tail [--follow]` et `.codebuddy/runs/` | regex CLI / `CODEBUDDY_RUNS_DIR` | `94d47794b` |

### Rejeu live après correctifs

- Tour 2 (212 s) : session `session_mtleydgi_z4yab6` **4303 in / 46 out, cost 0, provider ollama, qualité stocké**. Run `run_mtleydm6_d0ae35` : Tokens 4349, Tool calls 1, cwd jouet.
- `buddy cost --last` : `$0.0000`, 4,303 in / 46 out, `unknownCostTurns: 0`, ventilation `qwen3:4b-instruct` / `ollama`.
- `buddy run replay run_mtleydm6_d0ae35` : **re-lit** `src/index.js` (contenu réel `postEntry` / `balanceOf`).
- Import : `claude-settings-nimbus` + `root-settings-nimbus` ajoutés, `existing-keep` intact, `description: À préserver`.
- Explain : `Langages : JavaScript (2 fichiers, 100 %)`. **NO TypeScript.**

**3 affirmations explain vérifiées sur disque :**

1. Marqueur `NIMBUS_LEDGER_MARK=7f3a` — présent dans `package.json` description et `src/ledger.js` ligne 1.
2. 6 fichiers / 2 source / 1 test — `README.md`, `package.json`, `src/index.js`, `src/ledger.js`, `tests/ledger.test.mjs`, `HARVEST.md`.
3. Entrée `src/index.js` — le fichier existe et importe `./ledger.js`. Aucun compte `vineyard` inventé (`HARVEST.md` : « Do not invent a `vineyard` account »).

## Tableau final

| Commande | Attendu | Obtenu avant | Correctif | Commit |
|---|---|---|---|---|
| `buddy cost` | 0 $, tokens réels, par modèle | 0 $ mais 0 tokens + « inconnu » | persister `turns` / `inputTokens` / `provider` | `986122b5d` |
| `buddy run list` | runs headless listés | OK (3 runs après) | — | — |
| `buddy run show` | tokens + tool calls vrais | Tokens 0, Tool calls 0 | compter `tool_call` + metrics cost tracker | `b183ce2b4` `999137f79` |
| `buddy run tail` | suit un run en cours | OK live (`GK28-TAIL-MARKER`) | doc seulement | `94d47794b` |
| `buddy run replay` | rejoue vraiment | no-op « No test steps » | re-lire `view_file` + cwd | `0fc23c5c3` |
| `buddy changelog` | notes depuis tags, sans inventer | OK (`v0.2.0`→HEAD, 2 commits) | — | — |
| `buddy explain` | fondé sur les fichiers | TypeScript inventé | drop langues à 0 fichier | `461a66a12` |
| `buddy import` | fusion `.mcp.json` + `settings.json` | settings ignorés, existant conservé | sources Claude Code settings | `f24e8f14b` |

## Vérifications

- `npx tsc --noEmit -p tsconfig.json` : 0
- `npx tsc --noEmit -p tsconfig.gpuNode-identity.json` : 0
- ESLint ciblé des fichiers touchés : 0
- Union ciblée (hors FTS SQLite) : cost/import/explain/replay/docs/changelog/session-store verts
- 3 tests `run-store` FTS : `unavailable: true` — `npm install --ignore-scripts` n’a pas rebuild `better-sqlite3`. Préexistant au clone, pas un régress de GK28. Notre test `toolCallCount` est vert.

## Bilan (≤ 10 lignes)

Les six commandes ont été exercées en vrai (Ollama local, HOME `_qa/gk28/home`). `buddy changelog` et `buddy run tail` étaient déjà justes. Cinq défauts live (cost sans tokens, metrics 0, replay no-op, import settings silencieux, explain TypeScript, doc tail/runs) : rouge → vert, commits `986122b5d` … `94d47794b` + `999137f79`. Preuve post-fix : `buddy cost --last` = `$0` / 4303 in / 46 out / qualité stocké ; replay relit `src/index.js` ; import fusionne `settings.json` sans écraser. Reste : sessions antérieures au correctif restent « coût inconnu » ; index FTS SQLite non rebuild dans ce clone.
