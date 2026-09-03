# RAPPORT GK29 — Trois innovations « Code Buddy 2 » en vrai : Shadow Workspace, Time-Travel Sessions, Intent Ledger

Date : 2026-09-03
Agent : Grok 4.6
Clone : `/home/patrice/DEV/cb-repar-cowork-2026-09-02`
Branche : `fix/gk29-cb2-reel-2026-09-03`
HEAD au démarrage : `d0e067392` (`Merge GK23 (rappels de Lisa en vrai) into codex/audit-systeme-nerveux-2026-09-01`)
Original `~/code-buddy` : interdit (jamais ouvert, jamais écrit)
Rapport créé **avant toute inspection** du code CB2 (`src/speculative/`, `src/sessions/timeline.ts`, `src/intents/`, commandes `shadow`/`replay`/`intents`, tests, fiches `docs/cb2/`).

## Mission

Éprouver **pour de vrai** trois innovations opt-in Code Buddy 2, dans un dépôt jouet, agent headless Ollama, HOME temporaire dans le clone :

1. **Shadow Workspace** (`CODEBUDDY_SHADOW_WORKSPACE=true`) : une édition est validée dans le worktree fantôme **avant** de toucher les fichiers ; une édition qui casse les tests est **rejetée sans toucher le dépôt** (preuve sha256 avant/après) ; `buddy shadow` liste/nettoie.
2. **Time-Travel Sessions** (`CODEBUDDY_TIMELINE=true`) : trois tours → `buddy replay` liste ; `restore` d'un tour antérieur remet **exactement** l'état ; `fork` crée une branche de session.
3. **Intent Ledger** (`CODEBUDDY_INTENTS=true`) : `buddy intents` déclare une spec falsifiable (« le test X passe ») ; une édition qui la viole est signalée comme **dérive**.

Sans les variables : comportement **byte-identique** (test).

Loi : « se servir de ses applis EN VRAI ». Chaque défaut (validation fantôme qui laisse passer, restore partiel, dérive non détectée, doc fausse) : test rouge → correctif → vert, un commit.

## Garde-fous

- Aucun `git push`, `git prune`, `git reset --hard`, `rm -rf`, `git add -A`, `git commit -a`.
- Aucune API payante. Ollama local uniquement (`qwen3:4b-instruct`).
- Aucun service systemd. ComfyUI 8188/8189 non touché.
- HOME temporaire `_qa/gk29/home` (et `_qa/gk29/home-timeline`, workdir `_qa/gk29/work/toy`) dans le clone seulement. Le vrai `~/.codebuddy` n'est pas écrit.
- Buddy invoqué depuis le clone : `node node_modules/tsx/dist/cli.mjs src/index.ts`.
- Un commit conventionnel par lot, fichiers nommés un par un.

## Journal

| Heure (Europe/Paris) | Action |
|---|---|
| 12:45 | Rapport créé **avant inspection**. Coordination réservée (`61471a4cd`). |
| 12:46–12:57 | Inspection CLAUDE.md § CB2, `docs/cb2/*`, `src/speculative/shadow-workspace.ts`, `src/sessions/timeline.ts`, `src/intents/*`, commandes, câblage write-gate, CheckpointManager in-mémoire. |
| 12:53 | `npm install` isolé (`HOME`/`TMPDIR`/`npm_config_cache` sous `_qa/gk29`). 1848 paquets, exit 0. `package-lock.json` (licence npm) restauré, hors sujet. |
| 12:57 | E1 rouge : `buddy shadow` = `status`/`run` seulement. |
| 12:58 | E1 vert : `list`/`clean` + sidecar d'origine. 14/14 shadow. |
| 13:00 | E2 rouge : module snapshot absent, restore in-mémoire. |
| 13:02 | E2 vert : snapshots disque, restore exact (y compris fichiers nés plus tard). 9/9 timeline/replay. |
| 13:05 | E3 rouge : 3 `-p` → 3 fichiers session. |
| 13:06 | E3 vert : `--resume` hydraté. 8/8 headless. |
| 13:10 | Write-gate sha256 + dérive d'intent : tests collés, déjà verts (pas un trou de code). |
| 13:12 | Live CLI : `shadow status/run/list/clean` ; `intents check` PASS puis `drift` DRIFT (exit 1) après `add` cassé. |
| 13:13–13:17 | Agent Ollama 4b : n'a pas appelé `str_replace` (refus jailbreak / outil `patch` fantôme / déni du motif). sha256 `sum.js` inchangé. |
| 13:18–13:19 | 3 tours Ollama `--resume` sur une session : `buddy replay` 1/2/3, fork tour 2, restore tour 1 ramène `sum.js` `ec5294b2…`. |

## Fichiers lus

- `CLAUDE.md` (§ Code Buddy 2 — 10 innovations opt-in)
- `docs/cb2/README.md`, `shadow-workspace.md`, `time-travel.md`, `intent-ledger.md`
- `docs/specs/cb2/INNOV-01-shadow-workspace.md`, `INNOV-02-time-travel.md`, `INNOV-03-intent-ledger.md`
- `src/speculative/shadow-workspace.ts`, `src/commands/shadow.ts`
- `src/sessions/timeline.ts`, `src/commands/replay.ts`
- `src/intents/intent-store.ts`, `intent-checker.ts`, `intent-generator.ts`, `src/commands/intents.ts`
- `src/tools/review-gate-helper.ts`, `src/tools/text-editor.ts`, `src/tools/apply-patch.ts`
- `src/checkpoints/checkpoint-manager.ts`, `src/checkpoints/persistent-checkpoint-manager.ts`
- `src/agent/codebuddy-agent.ts` (hook timeline), `src/agent/execution/agent-executor.ts` (`recordCompletedTimelineTurn`)
- `src/index.ts` (`processPromptHeadless`)
- Tests existants : `tests/speculative/shadow-*.test.ts`, `tests/sessions/timeline.test.ts`, `tests/commands/replay.test.ts`, `tests/intents/*`, `tests/cli/headless-exit-code.test.ts`

## Écarts

### E1 — `buddy shadow` ne listait ni ne nettoyait — FERMÉ

Le P0 n'exposait que `status|run`. Le worktree fantôme persistait sous `~/.codebuddy/shadow/<hash>/` sans inventaire ni retrait.

- Rouge : `tests/speculative/gk29-shadow-list-clean.test.ts` — commandes `['status','run']`.
- Correctif : `list` (hash, présence, dépôt d'origine, chemin) et `clean` (`git worktree remove --force`, jamais l'arbre réel). Sidecar `<hash>.origin`.
- Vert : 2/2 + 12 voisins shadow. Commit `56584265f`.

### E2 — `buddy replay --at N --yes` ne remettait pas l'état exact — FERMÉ

`CheckpointManager` est in-mémoire, snapshot **avant** édition du **dernier** fichier du tour. Un nouveau processus CLI disait « Checkpoint not found ». Un restore partiel laissait les fichiers nés plus tard.

- Rouge : import `src/sessions/timeline-snapshot.ts` manquant.
- Correctif : snapshot disque post-tour (`~/.codebuddy/timelines/snapshots/`). Restore réécrit l'arbre et supprime les fichiers apparus ensuite. Le mock in-mémoire des tests replay existants est inchangé.
- Vert : 1/1 GK29 + 8 replay/timeline. Commit `eb475230f`.

### E3 — un `-p` headless créait toujours une nouvelle session — FERMÉ

`processPromptHeadless` appelait `createSession` même après `--resume`/`--continue`. Trois tours = trois timelines.

- Rouge : `tests/cli/gk29-headless-resume.test.ts` — 3 fichiers session.
- Correctif : réutiliser `getCurrentSessionId()`, `hydratePersistedSession()`.
- Vert : 1/1 + 7 headless voisins. Commit `f58d69399`.

### Preuves déjà conformes (tests collés verts, pas de trou)

Write-gate réel (`TextEditorTool`) : édition qui casse `node --test` → `shadow validation failed`, sha256 identique ; sans variable, l'écriture passe. Intent CLI : `check` PASS, `done`, édition qui casse le test → `DRIFT`. Commit `9cee99b45`.

## Live (dépôt jouet + Ollama)

Jouet `_qa/gk29/work/toy` (`sum.js` + `tests/sum.test.js`, `node --test`). HOME `_qa/gk29/home` puis `_qa/gk29/home-timeline`.

| Commande | Résultat |
|---|---|
| `buddy shadow status -d toy` sans variable | `Enabled: no`, validator inactive |
| `CODEBUDDY_SHADOW_CMD='node --test tests/sum.test.js' buddy shadow run` arbre propre | `passed in 216ms (exit 0)` |
| même `run` après `add` cassé | `failed in 142ms (exit 1)`, stack **dans** le fantôme `~/.codebuddy/shadow/<hash>/tests/sum.test.js` ; sha256 réel `0637c32d…` (sale opérateur) puis restauré `ec5294b2…` |
| `buddy shadow list` / `clean` | liste l'origine du jouet ; `Removed shadow …` ; list ensuite `No shadow worktrees.` |
| `buddy intents` sans variable | exit 1, message opt-in |
| `intents check add-test-passes` | PASS, ledger `ok:true` |
| `intents drift` après `return a - b` | `add-test-passes: DRIFT` exit 1, ledger `drifted` |
| 3× `buddy -p` Ollama `qwen3:4b-instruct` `--resume` | 1 session `session_mtlfmmjo_agje6c`, 6 messages, `TURN1/2/3` |
| `buddy replay <id>` | tours 1, 2, 3 |
| `buddy replay --at 2 --fork gk29-fork-t2` | fork 4 messages / source 6, `forkedAtTurn: 2` |
| `buddy replay --at 1 --yes` après mutation `sum.js`→`return 999` | sha256 `ec5294b2…` restauré, `return a + b` |

Agent Ollama 4b **n'a pas exercé** le write-gate (pas d'appel `str_replace` réussi). Le rejet fantôme est prouvé par `TextEditorTool` + `buddy shadow run`.

## Tableau final « scénario → attendu → obtenu → correctif → commit »

| Scénario | Attendu | Obtenu | Correctif | Commit |
|---|---|---|---|---|
| `buddy shadow` liste/nettoie | `list` et `clean` | seulement `status`/`run` | CLI + sidecar origine | `56584265f` |
| Édition qui casse les tests | rejet fantôme, sha256 inchangé | conforme (write-gate + `shadow run` live) | tests de preuve | `9cee99b45` |
| Sans `CODEBUDDY_SHADOW_WORKSPACE` | écriture directe | conforme | test opt-in | `9cee99b45` |
| Restore d'un tour antérieur | arbre **exact** | in-mémoire / partiel | snapshots disque | `eb475230f` |
| 3 tours headless | une session, `replay` 1–3 | 3 sessions | `--resume` hydraté | `f58d69399` |
| `buddy replay --fork` | branche de session | conforme (live + tests) | — | `eb475230f` / live |
| Spec « le test add passe » | `check` PASS, dérive si cassé | conforme (CLI live + tests) | — | `9cee99b45` |
| Sans `CODEBUDDY_INTENTS` | exit 1, rien écrit | conforme | — | existant + live |
| Doc `buddy shadow` | list/clean | status/run seulement | README + fiche + CLAUDE.md | `56584265f` + lot docs |

## Vérifications

- Union ciblée : fichiers GK29 + voisins shadow/timeline/replay/intents/headless-resume.
- `npx tsc --noEmit -p tsconfig.json` : 0 (lots E1–E3).
- ESLint ciblé `--max-warnings=0` : 0.
- Aucun push. `package-lock.json` non commité. `_qa/gk29/` gitignoré.

## Reste ouvert

- `qwen3:4b-instruct` n'a pas appelé `str_replace` de façon fiable (refus / outil `patch` inventé). Le write-gate n'a pas été vu par cet LLM ; il l'est par l'éditeur et par `buddy shadow run`.
- Les snapshots de timeline capturent aussi `.codebuddy/` non ignoré du jouet (restore exact, un peu bruyant).
- `LOG_LEVEL=error` masque `logger.info` de `buddy intents list/show` ; le ledger prouve quand même le PASS.
