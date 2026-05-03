# CLAUDE.md

> **Status: 1.0.0-rc.5 — V1 release candidate** (May 2026). Multi-AI fleet hub
> (Phases (d).1 → (d).16a) is the headline feature. Through rc.5: auto-memory
> writeback, `/memory recent`, `AGENTS.md` cross-CLI scaffold, opt-in
> mid-stream retry, history curation API (Gemini CLI audit reco #3, 3/3
> closed), `Explore` read-only subagent + `disallowedTools` field
> (Claude Code audit Phase A+C), `/subagent` discovery slash, **`/swarm
> <task>`** team-lead UX inspired by Korben, **lessons feature activated**
> + **`<writing_rules>` directive** (Manus AI structured blocks pattern,
> @renschni gist) — completes the persistence trilogy auto-memory +
> lessons + writing discipline. Read
> [`docs/getting-started.md`](docs/getting-started.md) first. See
> [`docs/fleet-guide.md`](docs/fleet-guide.md) and
> [`CHANGELOG.md`](CHANGELOG.md).

Guidance for Claude Code when working in this repo. Keep this file short — it should capture what you *can't* derive by reading the source.

## Build, Test, Lint

```bash
npm install
npm run dev            # Bun dev mode
npm run dev:node       # tsx dev mode
npm run build          # TypeScript build
npm run typecheck
npm run lint
npm run validate       # lint + typecheck + test — run before committing
npm test               # Vitest — full suite is ~26K tests, slow. Prefer a path filter.
npm test -- path/to/file.test.ts
npm run test:run       # one-shot (no watch)
npm run build:gui      # Cowork Electron GUI
buddy install-gui && buddy gui
```

Tests live in `tests/` and in-source `src/**/*.test.ts`. Vitest + happy-dom. `vitest.setup.ts` shims `globalThis.jest` → `vi` so legacy `jest.fn()` works.

## Testing Gotchas

- ESM project (`"type": "module"`). Use `import.meta.url` + `fileURLToPath` for `__dirname`. `@` alias → `./src` (see `vitest.config.ts`). Source imports need `.js` extensions even for `.ts` files.
- Use `logger` (`src/utils/logger.js`) not `console.*` in production — tests spy on `logger.warn`.
- `BashTool` tests: call `ConfirmationService.setSessionFlag('bashCommands', true)` first, and mock every transitive import (`safe-binaries`, `auto-sandbox`, `shell-env-policy`, `bash-parser`, `checkpoint-manager`, `audit-logger`, `command-validator`, `streaming-executor`). `execute()` has async pre-spawn logic, so defer mock process events with `setImmediate()` — don't emit synchronously.
- CLI command tests: Commander `parseAsync()` + `exitOverride()`, mock `console.log` / `process.exit`.
- Channel adapter tests: mock `global.fetch` for health checks, mock dynamic imports via virtual modules.
- `DeviceNodeManager` tests: mock `ssh-transport` / `adb-transport` / `local-transport` and `fs` (prevents `devices.json` bleed between tests). `pairDevice()` is async.
- `AgentRegistry` ships 8 built-in agents: PDF, Excel, DataAnalysis, SQL, Archive, CodeGuardian, SecurityReview, SWE.

## Architecture

Terminal multi-provider AI coding agent (Grok / Claude / GPT / Gemini / Ollama / LM Studio, all via OpenAI-compatible routing). Core is an agentic loop where the LLM autonomously calls tools.

```
User → ChatInterface (Ink/React) → CodeBuddyAgent → LLM provider
                                         │
                                Tool calls (max 50, YOLO 400)
                                         │
                              Execute + confirm → results → loop
```

### Facades (`src/agent/facades/`)

`CodeBuddyAgent` delegates to:
- `AgentContextFacade` — token counting, `ContextManagerV2` compression, memory retrieval
- `SessionFacade` — save/load sessions, checkpoints, rewind
- `ModelRoutingFacade` — model selection, cost tracking, usage stats
- `InfrastructureFacade` — MCP servers, sandbox, hooks, plugins
- `MessageHistoryManager` — message storage, history truncation, export

### Key Entry Points

- `src/index.ts` — CLI entry (Commander), lazy-loaded commands, `--profile` flag
- `src/agent/codebuddy-agent.ts` — main agentic loop, `executePlan()`
- `src/agent/execution/agent-executor.ts` — middleware pipeline, reasoning, tool streaming. **Single source of truth via `runTurnLoop` async generator (task #5 fusion done 2026-04-26).** `processUserMessageStream` is a thin `yield*` wrapper; `processUserMessage` is a thin sequential collector that consumes events and returns the new entries pushed to history. Per-turn injections, transcript repair, output sanitization, and the `__SESSIONS_YIELD__` signal all live in `runTurnLoop` — touch them in one place. Streaming-only events (`ask_user`, `tool_stream`, `token_count`, `reasoning`, `steer`) are silently dropped in the sequential collector (décision #3).
- `src/codebuddy/client.ts` — thin dispatcher (~400 LOC) that delegates to a `Provider` strategy: `GeminiNativeProvider` when the baseURL points at `generativelanguage.googleapis.com`, `OpenAICompatProvider` otherwise. Strategies live under `src/codebuddy/providers/`. Adding a new provider = one new strategy file + a branch in the constructor. `defaultMaxTokens` comes from `getModelToolConfig(model).maxOutputTokens`. Anthropic-specific message hooks (`injectAnthropicCacheBreakpoints`, `injectJsonSystemPromptForAnthropic`) live in `provider-openai-compat-hooks.ts` and are called by both `chat()` and `chatStream()` on the OpenAI-compat strategy.
- `src/services/prompt-builder.ts` — **real** system prompt builder (not the deleted `src/agent/system-prompt-builder.ts`). Applies model-aware token-budget truncation.
- `src/codebuddy/tools.ts` — ~110 tool definitions + RAG selection
- `src/ui/components/ChatInterface.tsx` — React/Ink terminal UI

### Non-obvious Architecture Decisions

1. **Lazy loading** — Heavy modules are loaded via getters in `CodeBuddyAgent` and lazy imports in `src/index.ts`. Profile with `PERF_TIMING=true`.
2. **Model-aware limits** — `src/config/model-tools.ts` holds per-model capabilities (contextWindow, maxOutputTokens, patchFormat) with glob matching (`grok-3*`, `claude-*`). Start here for any model-specific behavior. System prompt is truncated to `(contextWindow − maxOutputTokens) × 50%`.
3. **RAG tool selection** — `src/codebuddy/tools.ts` filters tools per query via embeddings to reduce prompt tokens; cached after first round.
4. **Context compression** — `ContextManagerV2` (`src/context/context-manager-v2.ts`) uses sliding window + summarization; budget from `getModelToolConfig(model).contextWindow`.
5. **Middleware pipeline** — `src/agent/middleware/` has composable before/after hooks. Priorities matter: reasoning = 42, workflow-guard = 45. Register in `codebuddy-agent.ts` constructor.
6. **Confirmation service** — Singleton. Check order: permission mode → declarative rules → session flags → Guardian Agent.
7. **Per-turn context injection** — Each LLM turn appends `<lessons_context>` (before) and `<todo_context>` (after). Must be applied in both agent-executor paths.
8. **Pluggable ContextEngine** — Plugins can register a custom context pipeline via `PluginContext.registerContextEngine()`. If `ownsCompaction` is set, built-in auto-compact is skipped. Trust check blocks non-trusted plugins from owning compaction.
9. **Output sanitizer** (`src/utils/output-sanitizer.ts`) — strips model leakage tokens (`<think>`, `<|im_start|>`, `[INST]`, `<<SYS>>`, GLM-5/DeepSeek artifacts, zero-width chars) from LLM output. Wired into agent-executor + message-processor. Tests assert sanitized output, so don't bypass.
10. **Transcript repair** (`src/context/transcript-repair.ts`) — runs at all 3 `prepareMessages()` call sites in agent-executor. Removes orphaned tool results and injects synthetic results for lost tool_call pairs. Touch this if you change message construction or compaction.

### Reasoning

Two systems coexist:
- **Extended Thinking** (`src/agent/thinking/`) — provider-level (Grok `budget_tokens`). Levels: `off`/`minimal`/`low`/`medium`/`high`/`xhigh`.
- **ToT + MCTS** (`src/agent/reasoning/`) — modes `shallow`/`medium`/`deep`/`exhaustive`. MCTSr Q-value: `Q(a) = 0.5 * (min(R) + mean(R))`. Entry point: `reasoning-facade.ts`. User-facing: `/think` command and the `reason` tool. Reasoning middleware (priority 42) auto-detects complex queries and injects `<reasoning_guidance>`.

## Adding a Tool

1. Create class in `src/tools/` returning `Promise<ToolResult>` (`{ success, output?, error? }`).
2. Add OpenAI function definition in `src/codebuddy/tools.ts`.
3. Add execution case in `CodeBuddyAgent.executeTool()`.
4. Register in `src/tools/registry/` via the right factory.
5. Add metadata in `src/tools/metadata.ts` (keywords + priority — used by RAG selection and BM25 `tool_search`).

Codex-style aliases (`shell_exec`, `file_read`, `browser_search`, …) live in `src/tools/registry/tool-aliases.ts`.

## Edit Tool Matching

`str_replace` tries 5 strategies in cascade: **exact** → **flexible** (trim-normalized, preserves indent) → **regex** (tokenized on `():[]{}<>=,;`, joined with `\s*`) → **fuzzy** (Levenshtein, 10% threshold) → **LCS fallback** (90% similarity). Before any write/edit, content is scanned for omission placeholders (`// ... rest of code`, `// remaining methods ...`) — if present in `new_string` but not `old_string`, the edit is blocked.

## JIT Context

When a tool touches a path, the system walks upward to the project root loading any `CODEBUDDY.md` / `CONTEXT.md` / `INSTRUCTIONS.md` / `AGENTS.md` / `README.md` (and in `.codebuddy/` or `.claude/` subdirs). Max 4KB per discovery. `.codebuddy/settings.json → codebuddyMdExcludes` takes glob patterns to skip. CODEBUDDY.md supports `@path/to/file` imports (relative, `@~/…`, `@//…`), recursive to 5 levels.

## Config Files

- `src/config/model-tools.ts` — **start here for model-specific behavior**. Per-model caps with glob matching.
- `src/config/constants.ts` — `SUPPORTED_MODELS`, `TOKEN_LIMITS`
- `src/config/toml-config.ts` — config profiles (`[profiles.<name>]` deep-merged; `buddy --profile <name>`). Also `[model_pairs]` for architect/editor split.
- `src/config/advanced-config.ts` — effort levels (low/medium/high) → temperature + token params

## Coding Conventions

- TypeScript strict, avoid `any`
- Single quotes, semicolons, 2-space indent
- Files kebab-case (`text-editor.ts`); React components PascalCase (`ChatInterface.tsx`)
- Conventional Commits (`feat(scope): description`)
- ESM — imports need `.js` extension even from `.ts` sources

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `GROK_API_KEY` | Required API key from x.ai |
| `GROK_BASE_URL` / `GROK_MODEL` | Custom endpoint / default model |
| `CODEBUDDY_MAX_TOKENS` | Override response token limit |
| `CODEBUDDY_AUTOCOMPACT_PCT` | Auto-compact threshold as % of context window |
| `MORPH_API_KEY` | Enables fast file editing |
| `YOLO_MODE` / `MAX_COST` | Full autonomy ($10 default, $100 YOLO) |
| `JWT_SECRET` | Required in production for API server |
| `MCP` / search keys | `BRAVE_API_KEY`, `EXA_API_KEY`, `PERPLEXITY_API_KEY`, `OPENROUTER_API_KEY`, `FIRECRAWL_API_KEY` |
| `PICOVOICE_ACCESS_KEY` | Porcupine wake word (text-match fallback if absent) |
| `SENTRY_DSN`, `OTEL_EXPORTER_OTLP_ENDPOINT` | Observability |
| `PERF_TIMING`, `CACHE_TRACE`, `VERBOSE` | Debug flags |

## Special Modes

- **YOLO** — 400 tool rounds, $100 cap, auto-approve with guardrails. `src/utils/autonomy-manager.ts`. `/yolo on|off|safe|status|allow|deny`.
- **Agent modes** — `plan`, `code`, `ask`, `architect` — each restricts available tools.
- **Permission modes** — `default`, `plan`, `acceptEdits`, `dontAsk`, `bypassPermissions`. CLI: `--permission-mode <mode>`. Checked by `ConfirmationService` before every approval. `src/security/permission-modes.ts`.
- **Security modes** — `suggest` / `auto-edit` / `full-auto`.
- **Write policy** — `strict` (forces `apply_patch`) / `confirm` / `off`. `src/security/write-policy.ts`.
- **Plan mode** — `/plan` enters read-only research mode; write tools restricted to `.md` plan files.

## CLI & Slash Commands

Full list: `buddy --help` and `/tools` in-session. The ones most worth knowing:

```bash
buddy                       # Interactive chat
buddy --profile <name>      # Named config profile
buddy onboard               # Setup wizard
buddy doctor [--fix]        # Environment diagnostics + auto-migration
buddy dev plan|run|pr|fix-ci  # Golden-path workflows (forces WritePolicy.strict)
buddy run list|show|tail|replay  # Observability
buddy research "<topic>"    # Wide research
buddy flow "<goal>"         # Planning flow (plan → execute → synthesize)
buddy backup create|verify|list|restore
buddy update [--channel …] [--tag main] [--from-source]
```

In-session slash commands (not exhaustive):
```
/think off|shallow|medium|deep|exhaustive|status|<problem>
/batch <goal>                # Decompose into parallel sub-agents
/team start|add|status|...   # Agent Teams coordination
/compact [level]
/config [set] <key> <value>  # Dot-notation, SecretRef, --dry-run, batch JSON
/switch <model|auto>         # Mid-conversation model switch
/btw <question>              # One-shot, no tools, no history mutation
/pr [title] [--draft]
/lint run|fix|detect
/plan                        # Read-only research mode
```

## HTTP Server (`src/server/`)

Default ports: **3000** HTTP, **3001** Gateway WS. CORS enabled, rate-limit 100 req/min, JWT required in production.

Routes worth knowing: `/api/health`, `/api/chat`, `/api/chat/completions` (OpenAI-compatible), `/api/sessions`, `/api/memory`, `/api/a2a/*` (Google A2A: AgentCard discovery + task lifecycle), `/__codebuddy__/canvas/:id`, `/__codebuddy__/a2ui/`.

Gateway WS events: `connect` (pre-auth), `hello_ok`, `auth`, `chat`, `session_create|join|leave|patch`, `presence`. Origin-hardened (GHSA-5wcw-8jjv-m286): default `corsOrigins` is localhost-only, `trustedProxies` must be configured explicitly.
