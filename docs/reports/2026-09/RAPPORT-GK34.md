# RAPPORT GK34 — `/batch`, `/swarm`, `/team` et le Verifier en vrai

Date : 2026-09-03  
Agent : Grok 4.6  
Clone : `~/DEV/cb-repar-security-2026-09-02`
Branche : `fix/gk34-multi-agents-reel-2026-09-03`  
HEAD de départ : `1ecb8a07e`  
Réservation : `e0cdc3a80`

Ce rapport a été créé **avant** toute inspection de `src/agents/`, `src/orchestration/`, `src/commands/{batch,swarm,team}*.ts` et des tests associés, puis complété au fil de l'eau.

## Contraintes

- Clone uniquement. Original `~/code-buddy` interdit.
- Aucun `git push`, `git prune`, `git reset --hard`, `rm -rf`, `git add -A`, `git commit -a`.
- Aucune API payante. Ollama `qwen3:4b-instruct` (un seul modèle chargé, jamais deux 27B).
- Aucun service (ComfyUI 8188, buddy 3000/3001 de `~/code-buddy`) touché.
- HOME isolé `_qa/gk34/home` (gitignoré).
- Jouet `_qa/gk34/toy/` : `src/add.js` cassé, `src/slugify.js` vide, pas de README.

## Inspection (après création du rapport)

Les commandes ne sont pas `src/commands/{batch,swarm,team}*.ts` : elles vivent dans `src/commands/handlers/{batch-handlers,swarm-handler,team-handlers}.ts`. Le Verifier est `src/agent/specialized/verifier-agent.ts`, délégué par `AgentRegistry.executeOn('verifier', …)`.

Constats avant correctif :

- `/batch` TUI/headless appelait `handleBatchSlashCommand(args)` **sans** `chatFn` ni `spawnFn` → un seul unit `main` + `(plan only)`.
- `buddy -p "/batch …"` envoyait le slash au LLM (pas de dispatch headless).
- `/swarm` / `/agents run` : fire-and-forget + exigence `GROK_API_KEY`.
- `/team` : coordination in-memory, perdue au process suivant.
- Verifier : `CONFIRMED` si le texte du modèle contenait le mot, même sans oracle.

## Tableau commande → attendu → obtenu → correctif → commit

| Commande | Attendu | Obtenu | Correctif | Commit |
|---|---|---|---|---|
| `buddy -p "/batch"` 3 tâches, fichiers distincts | diffs `src/add.js` / `src/slugify.js` / `README.md`, pas de course | Plan-only ; headless envoyait `/batch` au LLM ; 3 agents 262k → 500 EOF silencieux 10 min ; parse coupait `add(2, 3) returns` | numbered split + overlap serialize + spawn fichier + dispatch headless + concurrence 1 + parse line-start | `11d4c400e` `c3081e8cd` `9043fb296` `275f047c1` `a21b0761e` |
| `buddy -p "/swarm …"` | chef qui délègue et **rend compte** | « Workflow started », process mort, `GROK_API_KEY` obligatoire | wait si `CODEBUDDY_HEADLESS` ; Ollama sans clé payante | `c3081e8cd` |
| `/team start\|add\|status` | coordination visible | OK in-process ; perdu entre deux `buddy -p` | persist `~/.codebuddy/team-session.json` | `c3081e8cd` |
| `executeOn('verifier', …)` travail incomplet | NEEDS REVIEW + preuves | CONFIRMED possible sans tool | oracle `task_verify`/`bash`/`web_test` obligatoire | `ac7cc957f` |
| Doc `/batch` | décrit l'exécution | « Plan approval before execution » faux | `docs/agents.md` + `docs/getting-started.md` | lot documentaire |

## Preuves live (Ollama `qwen3:4b-instruct`, HOME `_qa/gk34/home`)

**`/team`** (4× `buddy -p`, 23 s) : start → add coder → add documenter → status ACTIVE, 2 membres, goal « Three independent toy tasks ». Fichier persisté `team-session.json`.

**`/batch`** (cwd jouet, 19 s, 3/3 OK, $0) :

```
[batch] start add     files=src/add.js     2.3s
[batch] start slugify files=src/slugify.js 9.0s
[batch] start README  files=README.md      16.9s
Completed: 3/3 (0 failed)
```

`node --test tests/add.test.js` : `add(2, 3) === 5` vert. `slugify` documenté. README écrit. Porcelain : trois chemins distincts (`M src/add.js`, `M src/slugify.js`, `?? README.md`).

**`/swarm`** (26 s) : orchestrator plan 11 s → coder `bash`×2 8 s → synthèse 7 s. Headless imprime `Workflow completed for: … Success: yes` et « The files src/add.js, src/slugify.js, and README.md all exist ».

**Verifier** `registry.executeOn('verifier', { action: 'verify', … })` sur `add` remis à `return -1` : `verdict NEEDS REVIEW`, evidence `AssertionError … -1 !== 5` (vrai `node --test`). Puis `add.js` restauré au résultat batch.

## Tests

`tests/commands/gk34-batch.test.ts`, `gk34-headless-slash.test.ts`, `agents-handler.test.ts`, `verifier-agent.test.ts`, `team-manager.test.ts`, `swarm-handler.test.ts` : **208 verts** sur le lot ciblé (union avec team-manager).

ESLint ciblé : 0 erreur (warning préexistant `setSwitchModelProvider` dans `enhanced-command-handler.ts`, non touché).

## Ouvert

- Spawn `/batch` fichier-scopé = un `chat()` + write, pas le `CodeBuddyAgent` complet (celui-ci 500 EOF sur ctx 262k). Les units sans chemin de fichier retombent encore sur l'agent lourd.
- Concurrence réelle GPU : défaut `CODEBUDDY_BATCH_CONCURRENCY=1` (Ollama un prefill à la fois). L'overlap de fichiers reste serialisé dans le plan.
- `/team` coordonne (membres, mailbox, tâches) mais n'exécute pas le code des teammates.
- Commentaire JSDoc de `src/add.js` du jouet dit encore « Broken on purpose » alors que le corps est `a + b`.

## Garde-fous tenus

Aucun push. `~/code-buddy` non écrit. ComfyUI `:8188` et `buddy server` 3000/3001 d'origine intacts. Un seul modèle Ollama (`qwen3:4b-instruct`). HOME uniquement sous `_qa/gk34/`.
