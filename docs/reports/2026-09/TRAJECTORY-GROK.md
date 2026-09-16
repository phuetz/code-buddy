# TRAJECTORY-GROK — C5 taxonomie d'effet des outils + C1 vue Trajectory unifiée

Date : 2026-09-06 (Europe/Paris)
Agent : Grok 4.6
Clone : `~/DEV/cb-heartwatch-2026-09-05`
Branche : `feat/trajectory-2026-09-06`
HEAD au départ : `35443b9ec` (`docs(audit): étude DeepSeek Harness vs Code Buddy`)
Original `~/code-buddy` : interdit (jamais ouvert, jamais écrit)
Rapport créé **avant toute inspection** (réservation `ea9b31947`).
HOME temporaire : `_qa/traj/home`. Aucune écriture dans le vrai `~/.codebuddy`.
Cahier des charges : `docs/audits/2026-09-06-deepseek-harness-etude.md` §4 C1 et C5.

## Mission

1. **C5 (S)** — `effect: 'read' | 'reversible' | 'emission'` sur `TOOL_METADATA` et le type. Test d'exhaustivité. Exposition dans `tool_search` / `buddy tools catalog`.
2. **C1 (M)** — `buddy run trajectory <runId> [--json] [--since]`. Fonction pure `buildTrajectory(sources)`. Aucune télémétrie nouvelle. Donnée absente → « non journalisé ».

## Garde-fous

- Aucun `git push`, `git prune`, `git reset --hard`, `rm -rf`, `git add -A`, `git commit -a`.
- Vitest : `HOME=~/DEV/cb-heartwatch-2026-09-05/_qa/traj/home` et `env -u FORCE_COLOR`.
- Jamais `/home/<user>` ni prénom dans les fichiers suivis (écrire `~`).
- ComfyUI 8188/8189 non touché.

## Journal

### 2026-09-06 — création du rapport (avant inspection)

HEAD `35443b9ec`. Branche déjà extraite. Réservation `ea9b31947`.

### Inspection (après réservation)

- Catalogue : 229 outils dans `src/tools/metadata.ts` (plus que « ~110 » — tous classés).
- `ToolMetadata` n'avait pas de classe d'effet. `IToolMetadata` avait `makesNetworkRequests` (non renseigné sur le catalogue RAG).
- RunStore journalise `tool_call` / `tool_result` (nom, args scrubés, durée, succès) et des **totaux** tokens/coût. Pas d'événement `metric` par tour. `confirmation_requested` est un type d'audit **jamais émis** par `ConfirmationService` (seulement granted/denied, et seulement en mémoire : `auditLogger.init()` n'est appelé nulle part).
- `buddy run trajectory` n'existait pas (seulement `trajectory-export` rédigé v1).
- `src/utils/audit-logger.ts` n'existe pas ; le journal est `src/security/audit-logger.ts`.
- Timeline session : `name` + `ok` + `filesTouched`, gated `CODEBUDDY_TIMELINE`.
- `Session.turns[]` **existe** (input/output/cost par tour, pas de cache).
- `ModelRoutingFacade.sessionCost` est en mémoire de process.

Écart assumé vs l'étude §4 : C1 n'ajoute **aucun** événement RunStore `permission`/`effect` (le brief l'interdit). C5 utilise le ternaire du brief (`read|reversible|emission`) plutôt que `effects{}` + `reversible: boolean` ; `view_file` est `read` (lecture pure), pas « reversible » au sens Harness. Cowork non touché.

### C5 — taxonomie

| Classe | n | Sens |
|---|---|---|
| `read` | 77 | Observation, pas de mutation durable, pas d'envoi, pas de spawn |
| `reversible` | 52 | Mutation fichiers/état local (CheckpointManager ou inverse connu) |
| `emission` | 100 | Réseau, message, spawn, kill, presse-papiers (perte de l'ancien contenu) |

Invariants : champ additif ; hors catalogue (MCP/authored) → `unknown` + warning unique, pas de throw. Test rouge si une entrée `TOOL_METADATA` n'a pas de classe.

`tool_search` affiche `effect: …` et `data.effects`. `buddy tools catalog [--json]` liste la classe. `buddy tools profile` l'ajoute aux décisions.

#### `read` (77)

`view_file`, `read_file`, `self_describe`, `self_evolution`, `list_directory`, `search`, `search_files`, `find_symbols`, `find_references`, `find_definition`, `search_multi`, `workspace_search`, `workspace_read`, `csv_analyze`, `paper_qa`, `internet_scout_plan`, `lead_scout_plan`, `lead_scout_enrichment_plan`, `get_todo_list`, `kanban_show`, `kanban_list`, `codebase_map`, `code_graph`, `camera_analyze`, `tool_search`, `video_analyze`, `video_long_form_plan`, `video_trailer_plan`, `video_route`, `understand_video`, `ocr`, `vision_analyze`, `object_detect`, `reason`, `docs_search`, `restore_context`, `context_expand`, `knowledge_search`, `ask_human`, `skills_list`, `skill_view`, `recall`, `relationship_context`, `lessons_search`, `lessons_list`, `lessons_graph`, `user_model_recall`, `lsp_definition`, `lsp_references`, `lsp_hover`, `lsp_symbols`, `lsp_diagnostics`, `find_bugs`, `scan_vulnerabilities`, `scan_secrets`, `advisor`, `ask_user_question`, `exit_plan_mode`, `sessions_list`, `sessions_history`, `session_search`, `code_explorer_ask`, `screen_memory`, `project_map`, `dep_inspect`, `code_stats`, `git_summary`, `todo_scan`, `json_query`, `csv_preview`, `env_doctor`, `port_check`, `bundle_analyze`, `license_check`, `sbom_generate`, `file_search`, `diff_files`.

#### `reversible` (52)

`create_file`, `write_file`, `str_replace_editor`, `patch`, `edit_file`, `multi_edit`, `apply_patch`, `design_system`, `meeting_notes`, `lead_scout_lesson_candidates`, `create_todo_list`, `update_todo_list`, `kanban_*` mutations, `screenshot`, `camera_snapshot`, `markdown_convert`, `pdf`, `document`, `archive`, `plan`, `export`, `qr`, `a2ui`, `canvas`, `todo_update`, `knowledge_add`, `create_skill`, `extension_forge`, `skill_manage`, `remember`, `replace_memory`, `remind`, `memory_propose`, `forget`, `lessons_add`, `lessons_propose`, `user_model_observe`, `knowledge_graph`, `lsp_rename`, `lsp_code_action`, `resolve_conflicts`, `generate_document`, `submit_plan`, `codebase_replace`, `scaffold_app`, `format_project`.

#### `emission` — justification (100)

| Outil | Pourquoi irréversible |
|---|---|
| `bash` | spawn shell |
| `terminal` | spawn shell |
| `interactive_shell` | PTY spawn |
| `process` | spawn ou kill |
| `app_server` | spawn serveur |
| `js_repl` | eval runtime |
| `execute_code` | subprocess |
| `code_exec` | exécution imbriquée |
| `git` | push/fetch distant |
| `docker` | spawn conteneur |
| `kubernetes` | API cluster |
| `web_search` | HTTP |
| `community_search` | HTTP |
| `weather` | HTTP |
| `stock_quote` | HTTP |
| `deep_research` | HTTP recherche |
| `comfy_recipe` | ComfyUI / GPU |
| `web_fetch` | HTTP |
| `web_scrape` | HTTP |
| `web_extract` | HTTP |
| `internet_scout_run` | navigation live |
| `browser_navigate` | navigateur |
| `browser_click` | entrée navigateur |
| `browser_type` | entrée navigateur |
| `browser_scroll` | entrée navigateur |
| `browser_back` | navigation |
| `browser_press` | entrée navigateur |
| `browser_vision` | capture |
| `browser_dialog` | UI navigateur |
| `browser_get_images` | fetch navigateur |
| `browser_console` | inspect navigateur |
| `browser_snapshot` | capture |
| `lead_scout_run` | scout sortant |
| `firecrawl_search` | HTTP |
| `firecrawl_scrape` | HTTP |
| `browser` | automation |
| `web_test` | navigateur + spawn |
| `browser_operator` | session navigateur |
| `computer_control` | synthèse clavier/souris |
| `office_macro_execute` | macros |
| `send_message` | message sortant |
| `discord` | API Discord |
| `discord_admin` | API Discord |
| `yb_query_group_info` | API Yuanbao |
| `yb_query_group_members` | API Yuanbao |
| `yb_send_dm` | message Yuanbao |
| `yb_search_sticker` | API Yuanbao |
| `yb_send_sticker` | message Yuanbao |
| `ha_list_entities` | API Home Assistant |
| `ha_get_state` | API Home Assistant |
| `ha_list_services` | API Home Assistant |
| `ha_call_service` | appel Home Assistant |
| `mixture_of_agents` | fan-out LLM |
| `spotify_playback` | API Spotify |
| `spotify_devices` | API Spotify |
| `spotify_queue` | API Spotify |
| `spotify_search` | API Spotify |
| `spotify_playlists` | API Spotify |
| `spotify_albums` | API Spotify |
| `spotify_library` | API Spotify |
| `x_search` | API X |
| `feishu_doc_read` | API Feishu |
| `feishu_drive_list_comments` | API Feishu |
| `feishu_drive_list_comment_replies` | API Feishu |
| `feishu_drive_reply_comment` | message Feishu |
| `feishu_drive_add_comment` | message Feishu |
| `cronjob` | travail futur |
| `spawn_subagent` | spawn agent |
| `audio` | capture / sortie audio |
| `text_to_speech` | parole |
| `image_generate` | API/GPU génération |
| `lisa_selfie` | API/GPU génération |
| `image_edit` | API/GPU génération |
| `video` | pipeline média |
| `video_generate` | API/GPU génération |
| `video_stitch` | spawn ffmpeg |
| `video_quality_gate` | spawn ffmpeg |
| `video_flow_handoff` | API Flow |
| `gpu_media_job` | job GPU |
| `clipboard` | écrasement (contenu précédent perdu) |
| `run_script` | spawn script |
| `diagram` | spawn renderer ou Kroki distant |
| `deploy` | déploiement distant |
| `skill_discover` | catalogues distants possibles |
| `device_manage` | ssh/adb |
| `spawn_parallel_agents` | spawn agents |
| `task_verify` | peut exécuter des tests |
| `terminate` | kill |
| `verify` | peut exécuter des tests |
| `delegate_agent` | spawn agent |
| `peer_delegate` | réseau flotte |
| `peer_chain` | réseau flotte |
| `list_peers` | réseau flotte |
| `route_peer` | `peer.describe` réseau |
| `sessions_send` | message inter-sessions |
| `sessions_spawn` | spawn session |
| `lint_project` | spawn linter |
| `test_runner` | spawn tests |
| `build_project` | spawn build |
| `http_probe` | HTTP |

GET réseau = `emission` : on ne peut pas « un-fetch ».

### C1 — vue Trajectory

Fichiers : `src/observability/run-trajectory.ts` (`buildTrajectory`, `renderTrajectory`), `src/observability/run-trajectory-load.ts` (I/O never-throws), `src/commands/run-cli/index.ts`, `src/observability/run-viewer.ts`. `trajectory-export` v1 **inchangé**.

Schéma JSON : `schemaVersion: 1`, `kind: "run_trajectory"`. Champ manquant : `{ journaled: false, reason: "non journalisé: …" }`. `--since` : ISO-8601 ou epoch ms. Pas d'opt-in (lecture seule).

Sources lues : RunStore events/metrics, `Session.turns` si `sessionId`, audit JSONL `~/.codebuddy/audit-YYYY-MM-DD.jsonl` s'il existe, timeline si `CODEBUDDY_TIMELINE=true`, `cost-history.json`, `rule-runs.jsonl`.

#### Non journalisé (livrable)

| Donnée demandée | État constaté |
|---|---|
| Tokens in/out **par tour** | Pas d'événement `metric`. Repli : `Session.turns[]` si le fichier session existe (cas du run live). Sinon non journalisé. |
| Tokens **cache** | Jamais dans RunStore ni `SessionTurnUsage`. |
| Coût par tour | Idem session turns ; `ModelRoutingFacade.sessionCost` est RAM process. |
| Permissions demandées | Type `confirmation_requested` déclaré, **jamais loggé**. Granted/denied seulement si `auditLogger.init({logDir})` — **jamais appelé** en production. |
| Bornes de tour | Absentes du RunStore agent (seulement `buddy dev` emet `step_start`). Timeline gated. |
| Fichiers touchés | Timeline `filesTouched` ou `patch_applied` / audit file_*. Sinon non journalisé. |
| PID processus | `bash` journalise `args.command`, jamais le pid. |
| Requêtes sortantes | Nom d'outil + classe C5 ; pas d'URL, pas de statut HTTP. |
| rule-runs.jsonl | Pas de `runId` ; overlap temporel seulement. Fichier absent sur un run CLI headless. |
| Historique chat | N'est pas une projection du RunStore (écart déjà dans l'étude). |

### Preuves

Vitest (`HOME=_qa/traj/home`, `env -u FORCE_COLOR`) :

- `tests/tools` : 172 fichiers / 1682 passés, 2 ignorés, 3 tests ignorés.
- `tests/cli` + `tests/commands/tools-commands.test.ts` + `tests/commands/run-commands.test.ts` : 22 fichiers / 164 passés.
- Premier lot combiné `tests/tools tests/cli tests/security/donnees-personnelles.test.ts` : 1846 passés, **1 timeout** `tests/cli/headless-output-flags.test.ts` (20 s, parallèle). Rejoué isolé : 7/7 en 5–8 s chacun. Préexistant sous charge, pas lié au diff.
- `tests/security/donnees-personnelles.test.ts` : 40/40.

`npx tsc --noEmit -p tsconfig.json` : exit 0.
ESLint ciblé (`--max-warnings=0`) : exit 0.
`git diff --check` : exit 0.

Run réel, HOME isolé, Ollama `qwen3:4b-instruct`, 0 € :

```
node dist/index.js -p "dis bonjour" --max-tool-rounds 1
→ run_mtpg47ts_67f53a  3485 in / 14 out  (metrics.json : 4190 / 14)

node dist/index.js run trajectory run_mtpg47ts_67f53a
```

```
Run trajectory  schema=1  kind=run_trajectory
Run: run_mtpg47ts_67f53a  status=completed
Objective: headless prompt
Session: session_mtpg47s6_9n2sv5
Started: 2026-09-06T06:43:42.880Z
Ended:   2026-09-06T06:44:28.472Z

── Résumé ────────────────────────────────
  Appels d'outils: 0
  Emission:        non journalisé: aucun appel d'outil
  Tokens in/out:   4190 / 14
  Tokens cache:    non journalisé: tokens cache agrégés
  Coût:            0
  Durée:           45.6s
  Points de non-retour: (aucun appel emission réussi journalisé)

── Tours ─────────────────────────────────
  non journalisé: bornes de tour non journalisées  ts=2026-09-06T06:43:42.880Z
    outils: (aucun)
    permissions: non journalisé: permissions (audit JSONL absent ou hors fenêtre)
    usage in/out/cache/cost: 4190 / 14 / non journalisé: tokens cache par tour / 0
    fichiers: non journalisé: fichiers touchés
    processus: non journalisé: processus lancés
    outbound: non journalisé: requêtes sortantes

── rule-runs ─────────────────────────────
  non journalisé: rule-runs.jsonl

── Non journalisé ────────────────────────
  - audit JSONL (auditLogger.init n'est appelé nulle part en production)
  - timeline désactivée (CODEBUDDY_TIMELINE ≠ true)
  - cost-history.json
  - rule-runs.jsonl
  - cache tokens (jamais journalisés dans RunStore ni SessionTurnUsage)
  - pids de processus
  - ModelRoutingFacade (coût de session en mémoire, non persisté)
  - confirmation_requested (type déclaré, jamais émis par ConfirmationService)
```

JSON `schemaVersion: 1`, `kind: run_trajectory`. Prompt sans outil : 0 emission, bornes de tour honnêtement absentes.

Doc : `docs/trajectory.md`, `docs/commands.md`, `CLAUDE.md` / `AGENTS.md` (`buddy run …|trajectory`).

## Bilan (10 lignes, pas de verdict)

C5 : 229 outils classés `read` (77) / `reversible` (52) / `emission` (100) ; test d'exhaustivité ; `tool_search` et `buddy tools catalog` exposent la classe.
C1 : `buildTrajectory(sources)` + `buddy run trajectory [--json] [--since]` ; `trajectory-export` inchangé ; aucune télémétrie nouvelle.
Le vrai livrable C1 est la liste « non journalisé » : cache tokens, pids, `confirmation_requested`, `auditLogger.init` jamais appelé, bornes de tour RunStore, URL/statut HTTP, coût facade RAM.
Preuve tests : `tests/tools` 1682 verts ; `tests/cli`+commandes 164 verts ; privacy 40/40 ; timeout parallèle `headless-output-flags` rejoué 7/7 isolé.
`tsc --noEmit` 0 ; eslint ciblé 0 ; `git diff --check` 0.
Run live Ollama `qwen3:4b-instruct` `run_mtpg47ts_67f53a` : 4190/14, 45,6 s, 0 outil, sortie collée ci-dessus.
HOME `_qa/traj/home` seulement. `~/code-buddy` et `~/.codebuddy` non ouverts. ComfyUI intact. Aucun push.
Reste ouvert : journaliser `confirmation_requested`, init du fichier audit, événement metric par tour, pid, cache tokens — hors brief (pas de télémétrie nouvelle).
Cowork panneau lecture seule de l'étude C1 : hors brief numéroté.
