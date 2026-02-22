# Code Buddy -- Audit Report

**Date:** 2026-02-22
**Scope:** Audit approfondi de toutes les fonctionnalites principales
**Method:** 7 agents specialises en parallele, exploration exhaustive du codebase
**Codebase:** ~1,133 fichiers source TypeScript | 585 fichiers de test | ~109 outils

---

## Table des matieres

1. [Resume executif](#1-resume-executif)
2. [Core Agent Loop & LLM Providers](#2-core-agent-loop--llm-providers)
3. [Tool System & Security](#3-tool-system--security)
4. [Context Engineering & Memory](#4-context-engineering--memory)
5. [UI, CLI & Slash Commands](#5-ui-cli--slash-commands)
6. [Infrastructure (Daemon, Channels, MCP, Plugins)](#6-infrastructure)
7. [Specialized Agents & Advanced Features](#7-specialized-agents--advanced-features)
8. [Test Coverage & Code Quality](#8-test-coverage--code-quality)
9. [Synthese des recommendations](#9-synthese-des-recommendations)

---

## 1. Resume executif

### Statistiques globales

| Metrique | Valeur |
|----------|--------|
| Fichiers source | 1,133 |
| Fichiers de test | 585 |
| Outils enregistres | ~109 |
| Slash commands | 81 (dont 10 mortes) |
| CLI subcommands | 26 |
| Channels | 8 adapters |
| Locales i18n | 6 (non utilisees) |
| ESLint errors | 14 |
| ESLint warnings | 241 |
| Code mort estime | ~4,000+ LOC |

### Findings par severite

| Severite | Nombre | Exemples cles |
|----------|--------|---------------|
| CRITICAL | 8 | SSRF non applique, lessons/todo perdus apres 1er round, `isGrokModel()` bug |
| HIGH | 14 | 10 slash commands mortes, CANVAS_TOOLS non charges, race PID daemon |
| MEDIUM | 18 | Routing duplique, store non evicte, Docker non pinne, i18n mort |
| LOW | 12 | PID permissions, cron output, locale timezone |

---

## 2. Core Agent Loop & LLM Providers

### Inventaire

| Feature | Statut | Localisation |
|---------|--------|-------------|
| Boucle agentique (sequentiel) | OK | `agent-executor.ts:226-487` |
| Boucle agentique (streaming) | OK | `agent-executor.ts:501-861` |
| Selection RAG des outils | OK | `agent-executor.ts:241` |
| Execution outils streaming | OK | `agent-executor.ts:693-717` |
| Compaction tool results | OK | `agent-executor.ts:175-216` |
| Compression contexte | OK | `context-manager-v2` |
| Suivi des couts | OK | `agent-executor.ts:354-356, 654, 789` |
| Comptage tokens | OK | `agent-executor.ts:236-237, 768-771` |
| Pipeline middleware | OK | `middleware/pipeline.ts` |
| Middleware: Cost Limit | OK | `middleware/cost-limit.ts` |
| Middleware: Turn Limit | OK | `middleware/turn-limit.ts` |
| Middleware: Context Warning | OK | `middleware/context-warning.ts` |
| Middleware: Workflow Guard | OK | `middleware/workflow-guard.ts` |
| Middleware: Auto-Observation | OK | `middleware/auto-observation.ts` |
| Model Routing | OK | `codebuddy-agent.ts:460-512` |
| Session Cost Limit | OK | `codebuddy-agent.ts:109-120` |
| YOLO Mode | OK | `codebuddy-agent.ts:95-107` |
| Tool Support Probing | WARN | `client.ts:179-282` |
| Gemini Support | OK | `client.ts:566-745` |

### Bugs trouves

**[CRITICAL] `isGrokModel()` verifie "codebuddy" au lieu de "grok"**
- `codebuddy-agent.ts:327` — `currentModel.toLowerCase().includes("codebuddy")` devrait verifier "grok"
- Impact: les parametres de recherche sont toujours desactives pour les modeles Grok

**[CRITICAL] Race condition dans le probe d'outils**
- `client.ts:179-218` — `probePromise = null` est mis a `null` APRES le check, pas avant
- Fenetre de course entre `toolSupportProbed = true` et `probePromise = null`

**[MEDIUM] Timing du compteur toolRounds dans le streaming**
- `agent-executor.ts:521-539` — Le middleware recoit `toolRounds=0` a chaque iteration jusqu'a la premiere execution d'outil

**[MEDIUM] Cout enregistre AVANT execution des outils**
- `agent-executor.ts:354-368` — Le cout est "reserve" dans le round N avant que les outils du round N+1 s'executent

### Code mort

- `codebuddy-agent.ts:214-223` — Enregistrement middleware async non-awaited (promise ignoree)
- `codebuddy-agent.ts:829` — `require()` CommonJS melange avec des `import()` ESM

### Performance

- **Selection outils a chaque iteration** (`agent-executor.ts:548`) — RAG embeddings repetes; devrait etre cache apres le 1er round
- **`getTodoTracker()` / `getLessonsTracker()` appeles a chaque iteration** — Operations filesystem repetees
- **`getModelToolConfig()` O(n) glob matching** a chaque requete (`client.ts:152`)

---

## 3. Tool System & Security

### Inventaire outils

| Categorie | Outils | Statut |
|-----------|--------|--------|
| File Operations | view_file, create_file, str_replace_editor, multi_edit | OK |
| System Execution | bash | OK (avec checks securite) |
| Search | search, find_symbols, find_references, find_definition | OK |
| Web | web_search, web_fetch | **WARN -- SSRF** |
| Todo/Attention | todo_update, restore_context, lessons_add, task_verify | OK |
| Advanced | git, docker, kubernetes, process, js_repl, subagent | OK |
| Multimodal | pdf, audio, video, screenshot, clipboard, ocr, diagram | OK |
| Computer Control | computer_control (CDP) | OK |
| Browser | browser (automation) | OK |
| Canvas/A2UI | visual_canvas, a2ui | **DEAD -- non charge** |
| MCP / Plugin | Dynamic via mcp__* / plugin__* | OK |
| Knowledge | knowledge_search, ask_human, create_skill | OK |

### Failles de securite

**[CRITICAL] SSRF Guard non applique sur tous les chemins HTTP**
- `web-search.ts:681` — `axios.get(url)` sans `assertSafeUrl()` dans `fetchPage()`
- `image-tool.ts:115` — `axios.get(url)` sans verification SSRF dans `downloadImage()`
- `assertSafeUrl()` existe dans `ssrf-guard.ts` mais n'est appele que dans `fetch-tool.ts`
- Vecteur d'attaque: enumeration/attaque de services internes via `web_fetch("http://127.0.0.1:8080/admin")`

**[HIGH] CANVAS_TOOLS definis mais jamais charges**
- `tool-definitions/canvas-tools.ts` (288 lignes) exporte `CANVAS_TOOLS`
- `tool-definitions/index.ts` re-exporte, MAIS `tools.ts` n'importe pas CANVAS_TOOLS
- Outils marques comme disponibles dans l'API publique mais non fonctionnels

**[HIGH] WebSearchMode non applique sur fetchPage()**
- `WebSearchMode` (`disabled|cached|live`) applique uniquement dans `search()` (ligne 241)
- `fetchPage()` (ligne 681) ignore completement le mode
- Bypass: `web_fetch()` fonctionne meme quand search_mode=disabled

**[HIGH] Shell Env Policy non integree dans bash-tool**
- `shell-env-policy.ts` definit une politique separee de `getFilteredEnv()` dans command-validator
- Deux implementations concurrentes non synchronisees

**[MEDIUM] Code validation absente de la creation de skills**
- `code-validator.ts` valide le code genere par le LLM dans text-editor et apply-patch
- MAIS PAS dans `create-skill-tool.ts` ni `js_repl`

**[MEDIUM] Registre d'outils dual-path**
- `FormalToolRegistry` (ITool pattern) vs definitions OpenAI dans `tools.ts`
- Les changements de metadata ne se synchronisent pas automatiquement

---

## 4. Context Engineering & Memory

### Inventaire

| Sous-systeme | Statut | Notes |
|-------------|--------|-------|
| ContextManagerV2 | OK | Sliding window + summarisation, tableaux bornes |
| Context Files | OK | Chargement par priorite, projet/global |
| Pre-compaction Flush | OK | Pattern NO_REPLY, singleton, echecs non-critiques |
| Restorable Compression | **BUG** | Parametre workDir manquant dans restore() |
| Observation Variator | OK | Rotation deterministe, singleton module |
| Todo Tracker | WARN | Singletons par repertoire, pas de garde anti-doublon |
| Lessons Tracker | WARN | Merge silencieux global/projet |
| Knowledge Manager | WARN | Charge async mais injection non verifiee |
| Prompt Builder | OK | Budget tokens model-aware, troncature correcte |
| Cache Breakpoints | OK | Detection stable/dynamique fonctionnelle |
| Agent Executor | **BUG** | Injection contexte manquante apres 1er round |

### Bugs trouves

**[CRITICAL] Lessons/Todo perdus apres le 1er round d'outils (path sequentiel)**
- `agent-executor.ts:421-423` — Apres la 1ere execution d'outil, les blocs `<lessons_context>` et `<todo_context>` ne sont PAS re-injectes
- Le path streaming (`agent-executor.ts:552-564`) est CORRECT et re-injecte a chaque round
- Impact: le modele oublie les patterns appris et la liste de taches apres le 1er outil

**[CRITICAL] RestorableCompressor perd le workDir**
- `restorable-compression.ts:163` — `readToolResultFromDisk(identifier)` appele sans passer `workDir`
- Fallback sur `process.cwd()` au moment de l'appel, pas le repertoire de travail original
- Impact: les resultats d'outils ecrits dans projetA/ ne sont pas retrouves si l'agent tourne depuis projetB/

**[HIGH] Store RestorableCompressor non evicte automatiquement**
- `Map<string, string>` grandit indefiniment — `evict()` existe mais n'est jamais appele
- Risque: fuite memoire dans les sessions daemon longues

### Design issues

- **Injection knowledge une seule fois** — Injecte dans le system prompt (une fois), alors que lessons/todo sont per-turn
- **Merge lessons silencieux** — Si global et projet ont le meme ID, le projet gagne sans avertissement
- **ObservationVariator global** — Le singleton n'est pas reinitialise entre les sessions daemon

---

## 5. UI, CLI & Slash Commands

### Slash commands mortes (definies sans handler)

| Commande | Token | Statut |
|----------|-------|--------|
| /shortcuts | `__SHORTCUTS__` | DEAD |
| /debug | `__DEBUG_MODE__` | DEAD |
| /tool-analytics | `__TOOL_ANALYTICS__` | DEAD |
| /think | `__THINK__` | DEAD |
| /queue | `__QUEUE_MODE__` | DEAD |
| /subagents | `__SUBAGENTS__` | DEAD |
| /new | `__NEW_SESSION__` | DEAD |
| /reset | `__RESET_CONTEXT__` | DEAD |
| /status | `__SESSION_STATUS__` | DEAD |
| /verbose | `__VERBOSE__` | DEAD |

### Problemes de routage

- **Routing duplique** — 10 commandes dans `client-dispatcher.handleInternalCommand()` ET dans `enhanced-command-handler`
  - `/clear`, `/model`, `/mode`, `/checkpoints`, `/restore`, `/init`, `/features`, `/lessons`, `/persona`, `/context`
- **Risque:** Maintenance confuse, potentiel de divergence de comportement

### UI (ChatInterface / ChatHistory)

- Types ChatEntry: tous geres (user, assistant, tool_result, tool_call, reasoning, plan_progress, steer, diff_preview)
- Types StreamingChunk: tous geres sauf `run_event` (probablement generique)
- **Statut global: SAIN**

### CLI Subcommands: 26 totales (toutes OK)

buddy, server, mcp-server, provider, mcp, pipeline, daemon, trigger, speak, heartbeat, hub, device, identity, groups, auth-profile, config, dev, runs, pairing, knowledge, research, todo, execpolicy, lessons, doctor, onboard

---

## 6. Infrastructure

### Inventaire

| Sous-systeme | Statut | Notes |
|-------------|--------|-------|
| DaemonManager | OK | PID file, SIGTERM + force SIGKILL, cleanup |
| HeartbeatEngine | OK | Suppression duplicats, heures actives |
| HealthMonitor | OK | Metriques CPU/mem, seuils configurables |
| CronAgentBridge | OK | Execution taches, delivery channels + webhooks |
| ChannelManager | OK | Multi-channel, pipeline messages, queue prioritaire |
| GroupSecurity | OK | Mention-gating, allowlist, rate limiting 2min |
| StreamingPolicy | OK | 8 defaults par channel (Telegram 4KB, Discord 1.9KB, etc.) |
| Server Express | OK | CORS, rate limit, auth middleware, headers securite |
| WebhookManager | OK | HMAC-SHA256 timingSafeEqual, protection prototype |
| IsolatedPluginRunner | OK | Worker thread, limites ressources, timeout 30s |
| DockerSandbox | OK | Detection Docker, limites ressources, timeout |
| OS Sandbox | OK | bubblewrap/landlock/seccomp (Linux), sandbox-exec (macOS) |
| ExtensionLoader | OK | Validation manifest, prevention path traversal |
| MCP Config | OK | 3 niveaux de priorite, resolution ${ENV_VAR} |
| ACPRouter | OK | Correlation IDs, registre agents, timeout |

### Problemes de securite

**[HIGH] Race condition PID file daemon**
- `daemon-manager.ts:81-97` — `readPid()` et `writePid()` non atomiques
- Si deux processus appellent `start(detach=true)` simultanement, le 2nd ecrase le PID file
- Fix: utiliser `fs.openSync(pidFile, 'wx')` (ecriture exclusive)

**[HIGH] Auth bypass si AUTH_ENABLED=false en production**
- `server/index.ts:85` — Si `AUTH_ENABLED=false`, TOUTES les routes sautent l'auth
- Fix: en production, exiger `JWT_SECRET` et fail-hard si absent

**[MEDIUM] Image Docker sandbox non pinnee par digest**
- `docker-sandbox.ts:47` — `node:22-slim` sans SHA256
- Risque supply-chain si l'image Docker Hub est compromise

**[MEDIUM] Worker plugin timeout sur init**
- `isolated-plugin-runner.ts:335-415` — Le timeout de 30s commence apres `sendMessage('init')`, pas avant le chargement du module
- Si le module bloque au top-level, court delai avant terminaison

**[LOW] Permissions PID file non restrictives**
- `daemon-manager.ts:261` — `writeFile()` avec permissions par defaut

---

## 7. Specialized Agents & Advanced Features

### Inventaire des features

| Feature | Fichiers cles | Integre? | Statut | LOC estime |
|---------|--------------|----------|--------|-----------|
| Wide Research | `wide-research.ts` | OUI | OK | 342 |
| Skills Registry + Hub | `skills/skill-registry.ts`, `skills/hub.ts` | OUI | OK | 2,000+ |
| Personas (hot-reload) | `personas/persona-manager.ts` | OUI | OK | 300+ |
| Identity Manager | `identity/identity-manager.ts` | PARTIEL | OK | 300+ |
| Run Observability | `observability/run-store.ts` | OUI | OK | 300+ |
| Tree-of-Thought | `reasoning/tree-of-thought.ts` | PARTIEL | WARN | 500+ |
| MCTS | `reasoning/mcts.ts` | PARTIEL | WARN | 400+ |
| Voice/Wake Word | `voice/wake-word.ts` | PARTIEL | OK | 200+ |
| **Extended Thinking** | `thinking/extended-thinking.ts` | **NON** | **DEAD** | 800 |
| **Repair Engine** | `repair/repair-engine.ts`, `fault-localization.ts` | **NON** | **DEAD** | 600 |
| **Specialized Agents (7)** | `specialized/agent-registry.ts`, `*-agent.ts` | **NON** | **DEAD** | 500+ |
| **Multi-Agent System** | `multi-agent/multi-agent-system.ts` | **NON** | **DEAD** | 700+ |
| **Task Planner (DAG)** | `planner/task-planner.ts` | **NON** | **DEAD** | 400 |
| **Orchestrator** | `orchestrator/supervisor-agent.ts` | **NON** | **DEAD** | 500+ |
| **i18n (6 locales)** | `i18n/index.ts` | **NON** | **DEAD** | 200 |

### Synthese code mort

- **~4,000+ LOC de features avancees non integrees** dans la boucle agent
- 7 agents specialises (PDF, Excel, SQL, Data, CodeGuardian, SecurityReview, Archive) construits mais jamais dispatches
- Multi-Agent System complet (5 strategies d'execution) jamais appele
- Extended Thinking 75% construit mais jamais instancie
- i18n pour 6 locales completement inutilise

### Recommendations

| Priorite | Feature | Action |
|----------|---------|--------|
| CRITICAL | Extended Thinking | Integrer via `/think --level deep` ou supprimer 800 LOC |
| CRITICAL | Repair Engine | Choisir entre RepairEngine et CodeGuardian, unifier, enregistrer dans tools.ts |
| CRITICAL | Specialized Agents | Integrer AgentRegistry.findAgentForFile() dans le dispatch ou EOL 500+ LOC |
| HIGH | Multi-Agent System | Evaluer si Wide Research couvre le meme besoin; si oui, deprecier 700 LOC |
| HIGH | Reasoning Facade | Consolider extended-thinking + tree-of-thought + token-budget-reasoning |
| MEDIUM | i18n | Supprimer ou integrer dans le CLI; actuellement 200 LOC inutilises |
| MEDIUM | Task Planner | Verifier si /plan + WorkflowRules couvrent le meme besoin |

---

## 8. Test Coverage & Code Quality

### Resume global

| Metrique | Valeur |
|----------|--------|
| Fichiers de test | 585 |
| Ratio test/source | 51.6% |
| ESLint errors | 14 |
| ESLint warnings | 241 |

### Matrice couverture par repertoire source

| Repertoire source | Fichiers source | Fichiers test | Couverture | Statut |
|-------------------|:-:|:-:|:-:|:-:|
| agent/ | 138 | 45 | 32.6% | Partiel |
| **tools/** | 109 | 11 | **10.1%** | **CRITIQUE** |
| security/ | 43 | 11 | 25.6% | HIGH |
| context/ | 49 | 7 | 14.3% | HIGH |
| commands/ | 64 | 8 | 12.5% | HIGH |
| **utils/** | 81 | 2 | **2.5%** | **CRITIQUE** |
| ui/ | 24 | 2 | 8.3% | HIGH |
| server/ | 21 | 12 | 57.1% | Bon |
| **channels/** | 54 | 2 | **3.7%** | **CRITIQUE** |
| **daemon/** | 7 | 1 | **14.3%** | **CRITIQUE** |
| sandbox/ | 6 | 10 | 166%* | Bon |
| config/ | 21 | 11 | 52.4% | Bon |
| middleware/ | 4 | 4 | 100% | Bon |
| memory/ | 12 | 7 | 58.3% | Bon |
| observability/ | 4 | 2 | 50% | Bon |
| **extensions/** | 1 | 0 | **0%** | **NON TESTE** |

*\*sandbox/ a plus de tests que de fichiers source (cas limites multiples)*

### Chemins critiques non testes

1. **src/tools/** (10.1%) — 98 fichiers d'outils avec couverture minimale
2. **src/channels/** (3.7%) — Nouveaux adapters (WhatsApp, Signal, Teams, Matrix) non testes
3. **src/utils/** (2.5%) — 81 utilitaires sans tests
4. **src/daemon/** (14.3%) — heartbeat.ts, health-monitor.ts non testes
5. **src/extensions/** (0%) — extension-loader.ts completement non teste

### ESLint errors (14 bloquants)

```
middleware-pipeline.ts:556,590  @typescript-eslint/no-this-alias
tools/*.ts (multiples)          no-useless-escape, no-empty
src/index.ts                    no-empty (catch blocks)
```

---

## 9. Synthese des recommendations

### CRITICAL (a corriger immediatement)

| # | Probleme | Fichier(s) | Effort |
|:-:|----------|-----------|:------:|
| 1 | SSRF guard manquant sur fetchPage() et downloadImage() | `web-search.ts:681`, `image-tool.ts:115` | 2h |
| 2 | Lessons/Todo non re-injectes apres 1er tool round (sequentiel) | `agent-executor.ts:420-431` | 3h |
| 3 | `isGrokModel()` verifie "codebuddy" au lieu de "grok" | `codebuddy-agent.ts:327` | 30min |
| 4 | Race condition probe outils | `client.ts:179-218` | 2h |
| 5 | RestorableCompressor perd le workDir | `restorable-compression.ts:163` | 1h |
| 6 | Extended Thinking: integrer ou supprimer 800 LOC | `thinking/extended-thinking.ts` | 4h |
| 7 | Repair Engine: unifier avec CodeGuardian | `repair/` | 6h |
| 8 | Specialized Agents: dispatcher ou supprimer 500+ LOC | `specialized/` | 4h |

### HIGH (a planifier dans le sprint)

| # | Probleme | Fichier(s) | Effort |
|:-:|----------|-----------|:------:|
| 9 | 10 slash commands mortes | `builtin-commands.ts` | 2h (suppr.) ou 20h (impl.) |
| 10 | CANVAS_TOOLS definis mais jamais charges | `tools.ts` | 1h |
| 11 | Race condition PID file daemon | `daemon-manager.ts:81-97` | 2h |
| 12 | Auth bypass si AUTH_ENABLED=false en prod | `server/index.ts` | 1h |
| 13 | WebSearchMode non enforce sur fetchPage() | `web-search.ts` | 1h |
| 14 | Shell Env Policy non integree dans bash-tool | `shell-env-policy.ts` | 3h |
| 15 | Auto-evict RestorableCompressor | `restorable-compression.ts` | 2h |
| 16 | Multi-Agent System: evaluer vs Wide Research | `multi-agent/` | 4h |
| 17 | Ajouter ~25 tests unitaires pour outils | `src/tools/` | 40-50h |
| 18 | Tests security validation | `code-validator.ts`, `syntax-validator.ts` | 12-16h |
| 19 | Tests context compression | `context-manager-v2.ts` | 10-15h |
| 20 | Tests channel adapters | `src/channels/` | 20-30h |
| 21 | Fixer 14 ESLint errors | `middleware-pipeline.ts`, `tools/*.ts` | 2-3h |
| 22 | Code validation dans create-skill-tool | `create-skill-tool.ts` | 2h |

### MEDIUM (maintenance)

| # | Probleme | Fichier(s) | Effort |
|:-:|----------|-----------|:------:|
| 23 | Routing slash commands duplique | `client-dispatcher.ts`, `enhanced-command-handler.ts` | 6h |
| 24 | Docker sandbox image non pinnee | `docker-sandbox.ts:47` | 1h |
| 25 | Glob matching model-tools.ts | `model-tools.ts:296-302` | 2h |
| 26 | i18n: supprimer ou integrer | `i18n/` | 2h (suppr.) |
| 27 | Registre d'outils dual-path | `tools.ts`, `tool-registry.ts` | 8h |
| 28 | ObservationVariator global (pas per-session) | `observation-variator.ts` | 2h |
| 29 | Pre-compaction flush: erreurs plus granulaires | `precompaction-flush.ts` | 1h |
| 30 | Merge lessons silencieux | `lessons-tracker.ts:85-90` | 1h |

### LOW (nice-to-have)

| # | Probleme | Fichier(s) | Effort |
|:-:|----------|-----------|:------:|
| 31 | PID file permissions 0600 | `daemon-manager.ts:261` | 15min |
| 32 | Cache getTodoTracker/getLessonsTracker | `agent-executor.ts` | 1h |
| 33 | Cache getModelToolConfig par modele | `client.ts` | 1h |
| 34 | Dedupliquer yields tool calls streaming | `agent-executor.ts:619-635` | 1h |
| 35 | Task Planner: verifier vs /plan | `planner/` | 2h |
| 36 | Tests UI components | `ui/` | 8-12h |
| 37 | Tests extension-loader | `extensions/` | 3-4h |
| 38 | Reduire lint warnings sous 100 | global | 3-5h |

---

## Effort total estime

| Categorie | Effort |
|-----------|:------:|
| CRITICAL fixes | ~22h |
| HIGH fixes | ~130h |
| MEDIUM cleanup | ~23h |
| LOW improvements | ~20h |
| **Total** | **~195h** |

---

*Rapport genere par 7 agents d'audit specialises operant en parallele sur le codebase Code Buddy v2.9.0.*

---

## 10. Corrections appliquees (2026-02-22)

Suite a l'audit, les corrections suivantes ont ete implementees dans la meme session :

### CRITICAL fixes appliques

| # | Fix | Fichier(s) modifie(s) |
|:-:|-----|----------------------|
| 1 | SSRF guard ajoute sur `fetchPage()` et `downloadImage()` | `web-search.ts`, `image-tool.ts` |
| 2 | Lessons/Todo re-injectes a chaque round d'outils (path sequentiel) | `agent-executor.ts` |
| 3 | `isGrokModel()` corrige : verifie "grok" au lieu de "codebuddy" | `codebuddy-agent.ts` |
| 5 | `RestorableCompressor` capture `workDir`, auto-eviction a 500 entrees | `restorable-compression.ts` |

### HIGH fixes appliques

| # | Fix | Fichier(s) modifie(s) |
|:-:|-----|----------------------|
| 9 | 10 slash commands mortes supprimees | `builtin-commands.ts` |
| 12 | Auth forcee en production (`NODE_ENV=production` → `authEnabled: true`) | `server/index.ts` |

### Compatibilite Windows

| Categorie | Action |
|-----------|--------|
| `.gitattributes` | Cree avec `* text=auto eol=lf` pour line endings coherents |
| `better-sqlite3` | Recompile pour Windows (`npm rebuild`) |
| `permission-config.ts` | Normalisation `/` dans `pathMatches()` pour cross-platform |
| ~40 fichiers de tests | Chemins Unix → `path.resolve()`/`path.join()`, `/tmp` → `os.tmpdir()`, locale-aware, Unix-only tests skipped |

### Resultats tests apres corrections

| Metrique | Avant | Apres |
|----------|:-----:|:-----:|
| Suites en echec | 52 | ~12* |
| Tests en echec | 809 | ~20* |
| Tests passants | 23,377 | 24,109 |
| Taux de reussite | 96.7% | 99.7% |

*Les ~12 suites restantes sont des erreurs pre-existantes (TypeScript TS2345/TS2551, modules supprimes) ou des tests Unix-only (chmod, ripgrep) non applicables sur Windows.*
