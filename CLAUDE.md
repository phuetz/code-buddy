# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
npm install          # Install dependencies
npm run dev          # Development mode with Bun
npm run dev:node     # Development mode with tsx (Node.js)
npm run build        # Build with TypeScript
npm start            # Run built CLI
npm run typecheck    # TypeScript type checking only
npm run lint         # ESLint only
npm run validate     # Run lint + typecheck + test (use before committing)
```

## Testing

```bash
npm test                           # Run all tests
npm test -- path/to/file.test.ts   # Run a single test file
npm run test:watch                 # Watch mode
npm run test:coverage              # Coverage report
```

Tests are in `tests/` (and in-source `src/**/*.test.ts`) using **Vitest** with happy-dom. `vitest.setup.ts` shims `globalThis.jest` → `vi`, so legacy `jest.fn()` / `jest.spyOn()` calls work in tests.

**Testing gotchas:**
- `BashTool` tests require `ConfirmationService.setSessionFlag('bashCommands', true)`
- `BashTool` unit tests must mock all transitive imports (`safe-binaries`, `auto-sandbox`, `shell-env-policy`, `bash-parser`, `checkpoint-manager`, `audit-logger`, `command-validator`, `streaming-executor`) — the `execute()` method has async pre-spawn logic so mock process events must be deferred with `setImmediate()`, not emitted synchronously
- The project is ESM (`"type": "module"`) — use `import.meta.url` with `fileURLToPath` for `__dirname` equivalents in source; `@` alias maps to `./src` (configured in `vitest.config.ts`)
- CLI command tests: use Commander `parseAsync()` + `exitOverride()`, mock `console.log`/`process.exit`
- Mock dynamic imports via virtual modules for channel adapter tests
- Channel adapter tests (iMessage, etc.) must mock `global.fetch` for health checks and API calls
- `DeviceNodeManager` tests must mock transport modules (`ssh-transport`, `adb-transport`, `local-transport`) and `fs` (to prevent `devices.json` persistence across tests). `pairDevice()` is async — don't call synchronously
- Use `logger` (from `src/utils/logger.js`) not `console.warn/error` in production code — tests spy on `logger.warn` not `console.warn`
- The `AgentRegistry` has 8 built-in agents (PDF, Excel, DataAnalysis, SQL, Archive, CodeGuardian, SecurityReview, SWE)

## Architecture Overview

Code Buddy is a terminal-based multi-provider AI coding agent. Supports Grok, Claude, ChatGPT, Gemini, Ollama, LM Studio via OpenAI-compatible APIs. The core is an **agentic loop** where the AI autonomously calls tools.

### Core Flow

```
User Input → ChatInterface (Ink/React) → CodeBuddyAgent → LLM Provider
                                                │
                                       Tool Calls (max 50/400 rounds)
                                                │
                                      Tool Execution + Confirmation
                                                │
                                         Results → API (loop)
```

### Facade Architecture

`CodeBuddyAgent` delegates to specialized facades:

```
CodeBuddyAgent
  ├── AgentContextFacade       src/agent/facades/agent-context-facade.ts
  │     Token counting, ContextManagerV2 compression, memory retrieval
  ├── SessionFacade            src/agent/facades/session-facade.ts
  │     Save/load sessions, checkpoints, rewind
  ├── ModelRoutingFacade       src/agent/facades/model-routing-facade.ts
  │     Model selection, cost tracking, usage stats
  ├── InfrastructureFacade     src/agent/facades/infrastructure-facade.ts
  │     MCP servers, sandbox, hooks, plugins
  └── MessageHistoryManager    src/agent/facades/message-history-manager.ts
        Message storage, history truncation, export
```

### Key Entry Points

- `src/index.ts` — CLI entry (Commander), lazy-loaded commands, `--profile` flag
- `src/agent/codebuddy-agent.ts` — Main agentic loop, `executePlan()`, `needsOrchestration()`
- `src/agent/execution/agent-executor.ts` — Middleware pipeline, reasoning, tool streaming (both sequential + streaming paths)
- `src/codebuddy/client.ts` — LLM API client (multi-provider); `defaultMaxTokens` read from `getModelToolConfig(model).maxOutputTokens`
- `src/services/prompt-builder.ts` — **Real** system prompt builder (NOT `src/agent/system-prompt-builder.ts` which was deleted); calls `getSystemPromptForMode()`, applies model-aware token budget truncation
- `src/codebuddy/tools.ts` — Tool definitions + RAG selection (~110 tools total)
- `src/ui/components/ChatInterface.tsx` — React/Ink terminal UI

### Key Architecture Decisions

1. **Lazy Loading** — Heavy modules loaded on-demand via getters in `CodeBuddyAgent` and lazy imports in `src/index.ts`. Enable profiling with `PERF_TIMING=true`.

2. **Model-Aware Limits** — `src/config/model-tools.ts` defines per-model capabilities (contextWindow, maxOutputTokens, patchFormat) with glob matching (`grok-3*`, `claude-*`). Used by `client.ts` (response size) and `context-manager-v2.ts` (context budget). System prompt is truncated to `(contextWindow - maxOutputTokens) × 50%`.

3. **RAG Tool Selection** — `src/codebuddy/tools.ts` filters tools per query via RAG embedding to reduce prompt tokens. Tools are cached after first selection round.

4. **Context Compression** — `ContextManagerV2` (`src/context/context-manager-v2.ts`) uses sliding window + summarization when nearing limits. Uses `getModelToolConfig(model).contextWindow` for the budget.

5. **Middleware Pipeline** — `src/agent/middleware/` has composable before/after turn hooks (cost-limit, context-warning, turn-limit, reasoning at priority 42, workflow-guard at priority 45). Register via `codebuddy-agent.ts` constructor.

6. **Confirmation Service** — Singleton for destructive operations. Use `ConfirmationService.getInstance()` for file/bash operations needing approval.

7. **Checkpoints** — File operations create automatic snapshots via `CheckpointManager` for undo/restore.

8. **Per-Turn Context Injection** — Each LLM turn appends: `<lessons_context>` (before) → `<todo_context>` (after). Injected in both agent-executor paths.

### Reasoning Engines

Two systems coexist in `src/agent/thinking/` and `src/agent/reasoning/`:

**Extended Thinking** (`src/agent/thinking/extended-thinking.ts`):
- Provider-level thinking (Grok `budget_tokens`). Levels: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`

**Tree-of-Thought + MCTS** (`src/agent/reasoning/`):
- Modes: `shallow` (CoT single-pass), `medium` (ToT BFS), `deep` (MCTS), `exhaustive` (full MCTS + progressive deepening)
- MCTSr Q-value: `Q(a) = 0.5 * (min(R) + mean(R))` (arXiv 2406.07394)
- BFS beam search, token budget tracking, progressive deepening auto-escalation

| Component | Location | Purpose |
|-----------|----------|---------|
| Tree-of-Thought | `src/agent/reasoning/tree-of-thought.ts` | Thought generation, evaluation, `solve()` + `solveStreaming()` |
| MCTS | `src/agent/reasoning/mcts.ts` | MCTSr search with BFS/MCTS/progressive modes |
| Reasoning Facade | `src/agent/reasoning/reasoning-facade.ts` | Unified entry point, auto-mode selection, auto-escalation |
| Reasoning Middleware | `src/agent/middleware/reasoning-middleware.ts` | Priority 42, auto-detects complex queries (score 0-15), injects `<reasoning_guidance>` |
| `/think` handler | `src/commands/handlers/think-handlers.ts` | `/think off\|shallow\|medium\|deep\|exhaustive\|status\|<problem>` |
| `reason` tool | `src/tools/reasoning-tool.ts` + `src/codebuddy/tool-definitions/advanced-tools.ts` | LLM-callable tool for structured problem solving |

Streaming: `reason` tool yields MCTS progress events via `tool_stream` in agent-executor (alongside `bash`).

### Specialized Agents (`src/agent/specialized/`)

| Agent | Files | Purpose |
|-------|-------|---------|
| Code Guardian | `code-guardian/` | Architecture review, refactoring suggestions, patch planning |
| Security Review | `security-review/` | Vulnerability detection, compliance checks; `SecurityReviewSpecializedAgent` wraps inner `SecurityReviewAgent` with delegation methods |
| SQL Agent | `sql-agent.ts` | Schema analysis, query optimization |
| Archive Agent | `archive-agent.ts` | ZIP/TAR archive extraction and analysis |
| PDF/Excel/Data | `pdf-agent.ts`, `excel-agent.ts`, `data-analysis-agent.ts` | Domain-specific processing |
| SWE Agent | `swe-agent.ts`, `swe-agent-adapter.ts` | OpenManus-compatible code editing/debugging with think-act loop, stuck detection, terminate tool |

Managed by `agent-registry.ts` (8 built-in agents). Multi-agent coordination in `src/agent/multi-agent/` with roles: orchestrator, coder, reviewer, tester.

### OpenManus Architecture (`src/agent/state-machine.ts`, `src/agent/flow/`, `src/protocols/a2a/`)

OpenManus-compatible agent framework with 5 subsystems:

```
BaseAgent (state machine) → ReActAgent (think-act loop) → SWEAgent (code editing)
                                                        → BrowserAgent (web tasks)
PlanningFlow: plan → parallel/sequential execute → synthesize
A2A Protocol: AgentCard discovery + Task lifecycle (submit/cancel/status)
```

| Component | File | Key Types |
|-----------|------|-----------|
| State Machine | `src/agent/state-machine.ts` | `AgentStatus` enum (IDLE→RUNNING→THINKING→ACTING→FINISHED/ERROR), `AgentStateMachine` class with stuck detection (3 duplicate threshold), perturbation recovery |
| Terminate Tool | `src/tools/terminate-tool.ts` | `TERMINATE_SIGNAL` (`__AGENT_TERMINATE__`), detected in `agent-executor.ts` both sequential + streaming paths |
| SWE Agent | `src/agent/specialized/swe-agent.ts` | Think-act loop with bash + str_replace_editor + terminate tools, max-step limit, output truncation |
| Planning Flow | `src/agent/flow/planning-flow.ts` | `PlanningFlow` class, `PlanStepStatus` enum, dependency-ordered execution, retry, `FlowType.PLANNING` factory |
| A2A Protocol | `src/protocols/a2a/index.ts` | `A2AAgentServer` (executor callback), `A2AAgentClient` (registry + skill discovery), `AgentCard`, `Task`, `TaskStatus` |

CLI: `buddy flow "<goal>"` — HTTP: `GET /api/a2a/.well-known/agent.json`, `POST /api/a2a/tasks/send`

### Repair System (`src/agent/repair/`)

Automatic error correction pipeline: `repair-engine.ts` → `fault-localization.ts` (AST-based, 15KB) → `iterative-repair.ts` (multi-pass, 27KB) → `repair-templates.ts`.

### CodeAct Workflow

For complex tasks: **PLAN → THINK → CODE → OBSERVE → UPDATE**

- `src/tools/plan-tool.ts` — PLAN.md with checkbox status: `[ ]` pending, `[/]` in-progress, `[x]` done, `[-]` skipped
- `src/tools/run-script-tool.ts` — Python/TS/shell scripts in Docker sandbox
- `src/agent/middleware/workflow-guard.ts` — Priority-45: 3+ action verbs in first message + no PLAN.md → suggests plan init

### Tool Implementation Pattern

```typescript
// src/tools/ — each tool returns Promise<ToolResult>
interface ToolResult {
  success: boolean;
  output?: string;
  error?: string;
}
```

To add a new tool:
1. Create class in `src/tools/`
2. Add definition in `src/codebuddy/tools.ts` (OpenAI function calling format)
3. Add execution case in `CodeBuddyAgent.executeTool()`
4. Register in `src/tools/registry/` via the appropriate factory
5. Add metadata in `src/tools/metadata.ts` (keywords, priority for RAG selection)

Tool aliases (Codex-style): `shell_exec`, `file_read`, `browser_search`, etc. — defined in `src/tools/registry/tool-aliases.ts`.

### Key Subsystems Quick Reference

| Subsystem | Location | Notes |
|-----------|----------|-------|
| Daemon + cron | `src/daemon/` | PID file, health monitor, heartbeat engine, daily reset at 04:00, idle timeout, session maintenance (prune/rotate/cap), cross-platform service installer (launchd/systemd/schtasks) |
| Channels | `src/channels/` | Telegram, Discord, Slack, WhatsApp, Signal, Teams, Matrix, WebChat, IRC, Feishu/Lark, Synology Chat, LINE, Nostr, Zalo, Mattermost, Nextcloud Talk, Twilio Voice, iMessage, Twitch, Gmail |
| Pro channel features | `src/channels/pro/` | Lazy-loaded: scoped auth, diff-first, CI watcher, run tracker |
| Skills | `src/skills/` | Registry + hub marketplace; 40 bundled SKILL.md files |
| Identity | `src/identity/` | SOUL.md/USER.md/AGENTS.md, hot-reload, prompt injection |
| Knowledge | `src/knowledge/` | Knowledge.md loading, injected as `<knowledge>` block |
| Lessons | `src/agent/lessons-tracker.ts` | PATTERN/RULE/CONTEXT/INSIGHT, project + global `.codebuddy/lessons.md` |
| Todo tracking | `src/agent/todo-tracker.ts` | Manus-style attention bias, injected at END of each turn |
| Security | `src/security/` | write-policy, SSRF guard, bash-parser, shell-env-policy, skill-scanner |
| Observability | `src/observability/` | JSONL RunStore per run, `.codebuddy/runs/`, 30-run auto-prune; `tracing.ts` — OpenTelemetry via `OTEL_EXPORTER_OTLP_ENDPOINT`; Sentry via `SENTRY_DSN` |
| Browser automation | `src/tools/browser/`, `src/tools/registry/browser-tools.ts` | Real Playwright impl (`BrowserTool`); adapters: `browser_launch`, `browser_navigate`, `browser_action` |
| Vision / OCR | `src/tools/vision/`, `src/tools/registry/vision-tools.ts` | Tesseract.js OCR (`ocr_extract`), Sharp image processor (`image_process`) |
| Sandbox | `src/sandbox/` | Docker + OS sandbox; `SandboxMode` enum |
| MCP | `src/mcp/` | Predefined servers (ICM, etc.) |
| Plugins | `src/plugins/` | Worker thread isolation (`isolated-plugin-runner.ts`), conflict detection |
| Personas | `src/personas/` | Hot-reload FSWatcher, trait bars, `/persona` slash command |
| i18n | `src/i18n/` | 6 locales (en, de, es, ja, zh, fr); categories: common, cli, tools, errors, help |
| Services | `src/services/` | `prompt-builder.ts`, `plan-generator.ts`, `codebase-explorer.ts`, VFS router |
| Voice/TTS | `src/talk-mode/`, `src/input/`, `src/voice/` | Two separate TTS systems (don't conflate) |
| Reasoning | `src/agent/reasoning/` | ToT + MCTS engines, facade, `/think` command, `reason` tool |
| Gateway | `src/gateway/` | WebSocket server, connect/hello-ok handshake, device identity, presence tracking, session patching, auth (token/password/none), bind modes (loopback/all/tailscale) |
| Workflows | `src/workflows/` | Lobster typed DAG engine, approval gates with pause/resume tokens, variable resolution, cycle detection |
| Send Policy | `src/channels/send-policy.ts` | Rule-based deny/allow per channel, chatType, keyPrefix, peerId; runtime overrides via `/send on\|off\|inherit` |
| Msg Preprocessing | `src/channels/message-preprocessing.ts` | 4-stage pipeline: media detection → audio transcription → link extraction → content enrichment |
| Nodes | `src/nodes/` | Companion app management, device pairing (short codes), platform capability maps (20+ capabilities), remote invocation |
| Secrets Vault | `src/commands/cli/secrets-command.ts` | AES-256-GCM encrypted vault with scrypt KDF, key rotation, env import, audit trail |
| Deploy | `src/deploy/` | Cloud config generators (Fly.io, Railway, Render, Hetzner, Northflank, GCP), Nix flake support |
| Canvas | `src/server/routes/canvas.ts` | HTTP serving at `/__codebuddy__/canvas/` and `/__codebuddy__/a2ui/`, push/get/list content |
| Providers (extra) | `src/providers/additional-providers.ts` | Mistral, Deepgram, MiniMax, Moonshot, Venice AI, Z.AI via OpenAI-compatible routing |
| Automation | `src/automation/` | `PollManager` (URL/file/command polling with change detection), `AuthMonitor` (credential state tracking across providers/channels) |
| Commands | `src/commands/` | `EnhancedCommandHandler` (Map-based O(1) dispatch), `ClientCommandDispatcher` (UI delegation), `SlashCommandManager` |
| State Machine | `src/agent/state-machine.ts` | OpenManus-compatible agent states (IDLE/RUNNING/THINKING/ACTING/FINISHED/ERROR), stuck detection, perturbation recovery |
| Terminate Tool | `src/tools/terminate-tool.ts` | Explicit `__AGENT_TERMINATE__` signal for loop exit, detected in agent-executor sequential + streaming paths |
| Planning Flow | `src/agent/flow/planning-flow.ts` | Multi-agent plan → execute → synthesize, dependency ordering, retry, parallel steps; CLI: `buddy flow` |
| A2A Protocol | `src/protocols/a2a/index.ts` | Google Agent-to-Agent spec: AgentCard discovery, Task lifecycle, client/server; HTTP: `/api/a2a/` |

### Context Engineering Patterns

Applied in `agent-executor.ts` (both sequential and streaming paths):

- **Pre-compaction flush** (`src/context/precompaction-flush.ts`) — Silent LLM turn saves facts to MEMORY.md before compaction
- **Restorable compression** (`src/context/restorable-compression.ts`) — Extracts file/URL identifiers; tool results persisted to `.codebuddy/tool-results/<callId>.txt`
- **Observation variator** (`src/context/observation-variator.ts`) — Rotates 3 presentation templates per turn (anti-repetition)
- **Tool result compaction** — Pre-model check compresses oldest tool results when total > 70K chars

### Config Files

- `src/config/model-tools.ts` — Per-model capabilities with glob matching (**start here** for model-specific behavior)
- `src/config/constants.ts` — `SUPPORTED_MODELS`, `TOKEN_LIMITS`
- `src/config/toml-config.ts` — Config profiles: `[profiles.<name>]` deep-merged; `buddy --profile <name>`
- `src/config/advanced-config.ts` — Effort levels (low/medium/high) with temperature + token params

## Coding Conventions

- TypeScript strict mode, avoid `any`
- Single quotes, semicolons, 2-space indent
- Files: kebab-case (`text-editor.ts`), components: PascalCase (`ChatInterface.tsx`)
- Commit messages: Conventional Commits (`feat(scope): description`)
- ESM imports require `.js` extension even for `.ts` source files

## Environment Variables

| Variable | Description | Default |
|:---------|:------------|:--------|
| `GROK_API_KEY` | Required API key from x.ai | — |
| `CODEBUDDY_MAX_TOKENS` | Override response token limit | model's `maxOutputTokens` |
| `MORPH_API_KEY` | Enables fast file editing | — |
| `YOLO_MODE` | Full autonomy mode (requires `/yolo on`) | `false` |
| `MAX_COST` | Session cost limit in dollars | `$10` (YOLO: `$100`) |
| `GROK_BASE_URL` | Custom API endpoint | — |
| `GROK_MODEL` | Default model to use | — |
| `JWT_SECRET` | Secret for API server auth | Required in production |
| `PICOVOICE_ACCESS_KEY` | Porcupine wake word (text-match fallback if absent) | Optional |
| `BRAVE_API_KEY` | Brave Search for MCP web search | Optional |
| `EXA_API_KEY` | Exa neural search for MCP | Optional |
| `PERPLEXITY_API_KEY` | Perplexity AI (or via OpenRouter) | Optional |
| `OPENROUTER_API_KEY` | OpenRouter key | Optional |
| `CACHE_TRACE` | Debug prompt construction | `false` |
| `PERF_TIMING` | Startup phase profiling | `false` |
| `VERBOSE` | Verbose output | `false` |
| `SENTRY_DSN` | Sentry error reporting DSN | Optional |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OpenTelemetry OTLP endpoint for distributed tracing | Optional |

## Special Modes

- **YOLO Mode** — 400 tool rounds, $100 limit, auto-approve with guardrails. Key: `src/utils/autonomy-manager.ts`. Commands: `/yolo on|off|safe|status|allow|deny`
- **Agent Modes** — `plan`, `code`, `ask`, `architect` — each restricts available tools
- **Security Modes** — `suggest` (confirm all), `auto-edit`, `full-auto`
- **Write Policy** — `src/security/write-policy.ts`: `strict` (forces `apply_patch`), `confirm`, `off`

## CLI Commands Reference

```bash
# Core
buddy                          # Start interactive chat
buddy --profile <name>         # Use named config profile
buddy onboard                  # Interactive setup wizard
buddy doctor                   # Environment diagnostics

# Dev workflows
buddy dev plan|run|pr|fix-ci   # Golden-path workflows (enforces WritePolicy.strict)
buddy run list|show|tail|replay # Run observability

# Agents & orchestration
buddy research "<topic>"        # Wide research (--workers N --rounds N --output file)
buddy flow "<goal>"             # Planning flow (--max-retries N --verbose)
buddy pairing status|list|approve|add|revoke

# Data management
buddy knowledge list|show|search|add|remove
buddy lessons list|add|search|stats|export|decay
buddy todo list|add|done|update|remove

# Infrastructure
buddy daemon start|stop|restart|status|logs
buddy trigger list|add|remove
buddy hub search|install|publish|sync
buddy identity show|get|set|prompt
buddy groups status|list|block|unblock
buddy auth-profile list|add|remove|reset
buddy execpolicy check|list|add-prefix|dashboard
buddy pairing status|approve <code>

# New commands (OpenClaw parity)
buddy update [--channel stable|beta|dev] [--check] [--force]
buddy nodes list|pair|approve|describe|remove|invoke|pending
buddy secrets list|set|get|remove|rotate|audit|import-env
buddy approvals list|approve|deny|policy
buddy deploy platforms|init|nix
```

### Slash Commands (interactive session)

```
/think off|shallow|medium|deep|exhaustive  # Set reasoning depth
/think status                               # Show reasoning config & last result
/think <problem>                            # Run Tree-of-Thought on a problem
/persona list|use|info|reset               # Manage AI personas
/lessons list|add|search|stats             # Lessons management
/compact [level]                            # Compress conversation context
/config [key] [value]                       # View/set configuration
/tools [list|info]                          # List available tools
```

## HTTP Server (`src/server/`)

Key endpoints:
- `GET /api/health`, `GET /api/metrics`
- `POST /api/chat`, `POST /api/chat/completions` (OpenAI-compatible)
- `GET/POST /api/sessions`, `GET/POST /api/memory`
- `GET /api/daemon/status|health`, `GET/POST /api/cron/jobs`
- `GET /api/hub/search|installed`, `POST /api/hub/install`
- `GET /api/identity`, `PUT /api/identity/:name`
- `GET/POST /api/groups`, `GET/POST/DELETE /api/auth-profiles`
- `GET/POST /api/heartbeat/status|start|stop|tick`
- `GET /__codebuddy__/canvas/:id` — Canvas content serving
- `GET /__codebuddy__/a2ui/` — A2UI host page
- `POST /__codebuddy__/a2ui/eval` — A2UI eval endpoint
- `GET /api/a2a/.well-known/agent.json` — A2A agent card discovery
- `GET /api/a2a/agents`, `POST /api/a2a/tasks/send`, `GET /api/a2a/tasks/:id`, `POST /api/a2a/tasks/:id/cancel`

WebSocket events: `authenticate`, `chat_stream`, `tool_execute`, `ping/pong`

Gateway WebSocket (port 3001): `connect`, `hello_ok`, `auth`, `chat`, `session_create`, `session_join`, `session_leave`, `session_patch`, `presence`, `ping/pong`

Default: port 3000 (HTTP), port 3001 (Gateway WS), CORS enabled, rate-limit 100 req/min, JWT auth required in production.
