# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
npm install          # Install dependencies
npm run dev          # Development mode with Bun
npm run dev:node     # Development mode with tsx (Node.js)
npm run build        # Build with TypeScript
npm start            # Run built CLI
npm run validate     # Run lint + typecheck + test (use before committing)
```

## Testing

```bash
npm test                           # Run all tests
npm test -- path/to/file.test.ts   # Run a single test file
npm run test:watch                 # Watch mode
npm run test:coverage              # Coverage report
```

Tests are in `tests/` directory using Jest with ts-jest. Test files follow the pattern `*.test.ts`.

### Writing Tests

- Use descriptive test names: `it('should return error when file not found')`
- Mock external dependencies (API calls, file system for unit tests)
- Use `beforeEach`/`afterEach` for setup/cleanup
- Test error cases, not just happy paths

```typescript
// Example test structure
describe('ToolOrchestrator', () => {
  let orchestrator: ToolOrchestrator;

  beforeEach(() => {
    orchestrator = new ToolOrchestrator(mockDeps);
  });

  it('should execute tool and return result', async () => {
    const result = await orchestrator.execute('read_file', { path: '/test.txt' });
    expect(result.success).toBe(true);
  });

  it('should handle tool execution errors gracefully', async () => {
    const result = await orchestrator.execute('invalid_tool', {});
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});
```

## Architecture Overview

Code Buddy is an open-source multi-provider AI coding agent that runs in the terminal. It supports multiple LLM backends (Grok, Claude, ChatGPT, Gemini, Ollama, LM Studio) via OpenAI-compatible APIs and provider-specific SDKs. The core pattern is an **agentic loop** where the AI autonomously calls tools to complete tasks. It features multi-channel messaging (Telegram, Discord, Slack), a SKILL.md natural language skills system, pipeline workflows, DM pairing security, OpenClaw-inspired concurrency control, daemon mode for 24/7 background operation, DAG-based task planning, screen observation with event triggers, proactive agent communication, multi-agent orchestration with self-healing, voice conversation with multi-provider TTS (Edge TTS, OpenAI, ElevenLabs, AudioReader/Kokoro-82M), Gemini vision support (image_url → inlineData conversion), model failover chain, webhook triggers, Docker sandbox, skills registry with 40 bundled SKILL.md files, media pipeline, ACP inter-agent protocol, extension system, live canvas (A2UI), copilot proxy, **Open Manus / CodeAct** autonomy (dynamic script execution in Docker), **Persistent Planning** (PLAN.md), onboarding wizard + doctor diagnostics, **run observability** (JSONL event store, timeline replay), **pro channel features** (scoped auth, diff-first, CI watcher), and **golden-path dev workflows** (`buddy dev plan|run|pr|fix-ci`).

### Core Flow

```
User Input --> ChatInterface (Ink/React) --> CodeBuddyAgent --> LLM Provider
                                                   |
                                              Tool Calls (max 50/400 rounds)
                                                   |
                                          Tool Execution + Confirmation
                                                   |
                                            Results back to API (loop)
```

### CodeAct Workflow

For complex tasks, Code Buddy follows a structured **PLAN → THINK → CODE → OBSERVE → UPDATE** loop:
1. **PLAN:** Maintain persistent state in `PLAN.md` via `PlanTool`.
2. **THINK:** Break down logic and dependencies.
3. **CODE:** Generate and execute scripts (Python/TS) via `RunScriptTool` in a Docker sandbox.
4. **OBSERVE:** Analyze `stdout`/`stderr` and self-correct if necessary.
5. **UPDATE:** Mark progress in `PLAN.md` and proceed.

### Facade Architecture

The agent is decomposed into specialized facades for clean separation of concerns:

```
CodeBuddyAgent
    |
    +-- AgentContextFacade      # Context window and memory management
    |       - Token counting
    |       - Context compression
    |       - Memory retrieval
    |
    +-- SessionFacade           # Session persistence and checkpoints
    |       - Save/load sessions
    |       - Checkpoint creation
    |       - Rewind functionality
    |
    +-- ModelRoutingFacade      # Model routing and cost tracking
    |       - Model selection
    |       - Cost calculation
    |       - Usage statistics
    |
    +-- InfrastructureFacade    # MCP, sandbox, hooks, plugins
    |       - Hook execution
    |       - Plugin loading
    |       - MCP server management
    |
    +-- MessageHistoryManager   # Chat and LLM message history
            - Message storage
            - History truncation
            - Export functionality
```

### Key Architecture Decisions

1. **Lazy Loading** - Heavy modules are loaded on-demand via getters in `CodeBuddyAgent` and lazy imports in `src/index.ts` to improve startup time

2. **Tool Selection** - RAG-based tool filtering (`src/codebuddy/tools.ts`) selects only relevant tools per query, reducing prompt tokens. Tools are cached after first selection round.

3. **Context Management** - `ContextManagerV2` compresses conversation history as it approaches token limits, using summarization to preserve context across long sessions

4. **Confirmation Service** - Singleton pattern for user confirmations on destructive operations. Use `ConfirmationService.getInstance()` for any file/bash operations that need approval.

5. **Checkpoints** - File operations create automatic checkpoints via `CheckpointManager` for undo/restore capability

6. **Result-based Validation** - Input validators use `Result<T, E>` pattern (Rust-inspired) for type-safe error handling without exceptions

7. **Stream Helpers** - Standardized async iterable handling with `withStreamTimeout`, `withMaxIterations`, and `safeStreamRead`

### Key Entry Points

- `src/index.ts` - CLI entry, Commander setup, lazy loading (includes `daemon` and `trigger` commands)
- `src/agent/codebuddy-agent.ts` - Main orchestrator (agentic loop, tool execution, `executePlan()`, `needsOrchestration()`)
- `src/agent/facades/` - Facade classes for modular concerns
- `src/agent/execution/agent-executor.ts` - Middleware pipeline, reasoning, tool streaming
- `src/agent/middleware/` - Composable before/after turn hooks (cost-limit, context-warning, turn-limit)
- `src/agent/planner/` - DAG-based task planning (TaskGraph, TaskPlanner, DelegationEngine, ProgressTracker)
- `src/agent/observer/` - Screen observation, event triggers, trigger registry
- `src/agent/proactive/` - Push notifications, rate limiting, response waiting
- `src/agent/orchestrator/` - Multi-agent supervisor, shared context, self-healing, checkpoint rollback
- `src/agent/profiles/` - Agent profiles and trust folders
- `src/daemon/` - Daemon manager, lifecycle, cron-agent bridge, health monitor, heartbeat engine
- `src/daemon/heartbeat.ts` - Periodic agent wake with HEARTBEAT.md checklist, smart suppression
- `src/auth/profile-manager.ts` - API key rotation (round-robin/priority/random), session stickiness, exponential backoff
- `src/identity/identity-manager.ts` - SOUL.md/USER.md/AGENTS.md identity files, hot-reload, prompt injection
- `src/channels/group-security.ts` - Mention-gating, group allowlists, activation modes, rate limiting
- `src/skills/hub.ts` - ClawHub-inspired skills marketplace (search, install, publish, sync, lockfile)
- `src/commands/cli/openclaw-commands.ts` - CLI commands for heartbeat, hub, identity, groups, auth-profile
- `src/codebuddy/client.ts` - LLM API client (multi-provider, OpenAI SDK compatible)
- `src/codebuddy/tools.ts` - Tool definitions and RAG selection
- `src/ui/components/ChatInterface.tsx` - React/Ink terminal UI
- `src/talk-mode/` - TTS manager, providers (OpenAI, ElevenLabs, Edge, AudioReader), speech queue
- `src/talk-mode/providers/audioreader-tts.ts` - AudioReader/Kokoro-82M local TTS provider
- `src/input/text-to-speech.ts` - TextToSpeechManager used by voice conversation loop
- `src/input/voice-control.ts` - Continuous voice conversation (STT → Agent → TTS loop), Porcupine wake word integration
- `src/voice/wake-word.ts` - Wake word detection via Porcupine (Picovoice) with text-match fallback
- `src/server/index.ts` - HTTP/WebSocket API server (webhooks, heartbeat, hub, identity, groups, auth-profiles)
- `src/channels/whatsapp/index.ts` - WhatsApp via Baileys (QR pairing, media, reconnect)
- `src/channels/signal/index.ts` - Signal via signal-cli REST API (polling, groups, attachments)
- `src/channels/google-chat/index.ts` - Google Chat Workspace API (JWT auth, webhook events, cards)
- `src/channels/teams/index.ts` - Microsoft Teams Bot Framework (OAuth2, adaptive cards, proactive messaging)
- `src/channels/matrix/index.ts` - Matrix via matrix-js-sdk (E2EE, threads, media, auto-join)
- `src/channels/webchat/index.ts` - Built-in HTTP+WebSocket chat server with browser UI
- `src/doctor/index.ts` - Environment diagnostics (`buddy doctor`)
- `src/wizard/onboarding.ts` - Interactive setup wizard (`buddy onboard`)
- `src/agents/model-failover.ts` - Cascading provider failover chain
- `src/webhooks/webhook-manager.ts` - HMAC-verified webhook triggers
- `src/presence/typing-indicator.ts` - Typing & presence events for channels
- `src/canvas/canvas-server.ts` - Live Canvas A2UI (HTTP + WebSocket visual workspace)
- `src/sandbox/docker-sandbox.ts` - Docker-based command sandboxing
- `src/skills/skill-registry.ts` - Skills registry (bundled/managed/workspace, 40 bundled skills)
- `.codebuddy/skills/bundled/` - 25 SKILL.md files (PR workflow, dev tools, media, communication, smart home)
- `src/media/media-pipeline.ts` - Media ingest, tracking, transcription hooks
- `src/acp/protocol.ts` - Agent Communication Protocol router
- `src/extensions/extension-loader.ts` - Manifest-based extension system
- `src/copilot/copilot-proxy.ts` - IDE-compatible completions proxy
- `src/tools/apply-patch.ts` - Unified diff parser/applier (Codex-inspired, model outputs diffs instead of full files)
- `src/tools/run-script-tool.ts` - **CodeAct** execution engine (Python/TS/shell scripts in Docker sandbox)
- `src/tools/plan-tool.ts` - **Persistent Planning** tool (PLAN.md with checkbox status: `[ ]` pending, `[/]` in-progress, `[x]` done, `[-]` skipped)
- `src/tools/registry/plan-tools.ts` - Factory that registers PlanTool in the tool registry
- `src/tools/registry/script-tools.ts` - Factory that registers RunScriptTool in the tool registry
- `src/agent/repo-profiler.ts` - Auto-detects repo languages/frameworks/build commands; injects compact `contextPack` into agent system prompt; caches to `.codebuddy/repoProfile.json`
- `src/agent/turn-diff-tracker.ts` - Per-turn file change tracking with rollback support
- `src/agent/history-repair.ts` - Message history self-repair (fixes orphaned tool results, malformed sequences)
- `src/agent/cache-trace.ts` - Prompt construction debugging (enable via `CACHE_TRACE=true`)
- `src/config/model-tools.ts` - Per-model tool configuration (capabilities, context window, patch format)
- `src/utils/head-tail-truncation.ts` - Head/tail output truncation (keeps start+end of large outputs)
- `src/persistence/session-lock.ts` - PID-based session file locking (prevents concurrent writes)
- `src/security/skill-scanner.ts` - Static analysis of skill files for dangerous patterns
- `src/security/bash-parser.ts` - AST-based bash command parsing (tree-sitter with regex fallback)
- `src/security/write-policy.ts` - Singleton enforcing diff-first writes; three modes: `strict` (blocks direct writes, forces `apply_patch`), `confirm` (logs), `off`
- `src/utils/rtk-compressor.ts` - RTK command proxy (wraps bash commands with `rtk` for 60-90% token reduction)
- `src/memory/icm-bridge.ts` - ICM MCP server bridge for persistent cross-session memory
- `src/observability/run-store.ts` - JSONL event store per agent run (`.codebuddy/runs/run_<id>/`); tracks tool calls, patches, decisions, tokens/cost; auto-prunes to 30 runs; `streamEvents()` for live tailing; `appendEvent(type, data)` on active run; `getActiveRunStore()` / `setActiveRunStore()` module-level active store registry; `lesson_added` event type
- `src/observability/run-viewer.ts` - Terminal display: `showRun()`, `tailRun()`, `replayRun()`, `listRuns()`
- `src/channels/pro/` - Enterprise pro features (lazy-loaded); compose via `ProFeatures` facade
  - `pro-features.ts` - Dispatcher for `/repo`, `/branch`, `/pr`, `/task`, `/yolo`, `/runs`, `/run`, `/pins`
  - `scoped-auth.ts` - Tiered permissions (read-only → write-patch → run-tests → deploy), secret handles, temporary grants; persists to `~/.codebuddy/channel-scoped-auth.json`
  - `diff-first.ts` - Pending code-change previews with 30-min expiry, `onApply`/`onCancel` callbacks
  - `run-tracker.ts` - Run records with step timelines, artifacts, cost; persists to `~/.codebuddy/channel-runs/`; supports replay/rollback
  - `run-commands.ts` - `/runs` and `/run <id>` command handlers with permission gating
  - `ci-watcher.ts` - CI pipeline monitoring (GitHub Actions, GitLab CI, Jenkins, webhooks); deduplication, mute patterns, LLM cause analysis
  - `enhanced-commands.ts` - `/repo`, `/branch`, `/pr`, `/task`, `/pins` handlers with git/GitHub API
  - `callback-router.ts` - Routes channel callback queries (diff apply/cancel, run re-run, CI fix/mute, pin ops)
- `src/channels/telegram/pro-formatter.ts` - Telegram-specific ChannelProFormatter; uses short callback prefixes (`da_`, `dv_`, etc.) to fit Telegram's 64-byte `callback_data` limit
- `src/commands/dev/` - Golden-path developer workflows
  - `index.ts` - `buddy dev` subcommands: `plan`, `run`, `pr`, `fix-ci`, `explain`; enforces WritePolicy.strict + RunStore recording
  - `workflows.ts` - 4 named workflows (add-feature, fix-tests, refactor, security-audit): plan-first, test-after, artifact generation
- `src/commands/run-cli/index.ts` - `buddy run` subcommands: `list`, `show <id>`, `tail <id>`, `replay <id>`
- `src/knowledge/knowledge-manager.ts` - Knowledge base (Manus AI-inspired): loads `Knowledge.md` from project + `~/.codebuddy/knowledge/`, frontmatter with `title`/`tags`/`scope`/`priority`, injected as `<knowledge>` block into system prompt at startup
- `src/tools/ask-human-tool.ts` + `knowledge-tools.ts` - `ask_human` ITool: pauses agent via readline mid-task; 120s auto-timeout; for channels returns default answer when non-interactive
- `src/tools/create-skill-tool.ts` + `knowledge-tools.ts` - `create_skill` ITool: agent self-authors new SKILL.md to `.codebuddy/skills/workspace/`; hot-reloaded by SkillRegistry (OpenClaw self-authoring)
- `src/tools/registry/knowledge-tools.ts` - Registers `knowledge_search`, `knowledge_add`, `ask_human`, `create_skill` tools; also wired into `createAllToolsAsync()`
- `src/agent/wide-research.ts` - Wide Research (Manus AI-inspired): decomposes topic → N subtopics (LLM), spawns parallel CodeBuddyAgent workers, aggregates into final report; `WideResearchOrchestrator` emits progress events
- `src/commands/pairing.ts` - `buddy pairing` CLI: `status`, `list`, `pending`, `approve <code>`, `add`, `revoke` — wraps DMPairingManager (already implemented, now CLI-accessible)
- `src/commands/knowledge.ts` - `buddy knowledge` CLI: `list`, `show`, `search`, `add`, `remove`, `context`
- `src/commands/research/index.ts` - `buddy research "<topic>"` CLI: `--workers N`, `--rounds N`, `--output <file>`, streams progress events
- `src/agent/todo-tracker.ts` - Manus AI attention bias: singleton `TodoTracker` per working dir; `buildContextSuffix()` injected at END of preparedMessages in both sequential and streaming agent-executor paths each turn; `getTodoTracker(cwd)` factory
- `src/agent/lessons-tracker.ts` - Self-improvement loop: singleton `LessonsTracker` per working dir; `.codebuddy/lessons.md` (project) + `~/.codebuddy/lessons.md` (global); categories: PATTERN/RULE/CONTEXT/INSIGHT; `buildContextBlock()` injected BEFORE todo suffix each turn; `getLessonsTracker(cwd)` factory; `getStats()` → `LessonsStats` analytics (byCategory, bySource, oldestAt, newestAt); `export(format: 'md'|'json'|'csv')` → string; `autoDecay(maxAgeDays)` removes stale INSIGHT items and returns count
- `src/prompts/workflow-rules.ts` - Workflow orchestration rules injected into system prompt once per session: concrete plan triggers (3+ action verbs, 3+ files, new module), auto-correction protocol, verification contract, uncertainty protocol, elegance gate, subagent triggers; `getWorkflowRulesBlock()`
- `src/agent/middleware/workflow-guard.ts` - Priority-45 middleware: detects 3+ action verbs in first user message + no PLAN.md → emits `warn` steer suggesting plan init; exported from middleware/index.ts; registered as default pipeline in codebuddy-agent.ts constructor
- `src/tools/registry/lessons-tools.ts` - Registers `lessons_add` / `lessons_search` / `lessons_list` / `task_verify` tools; `createLessonsTools()` factory; `task_verify` runs tsc/tests/lint via RepoProfiler auto-detection; `lessons_add` emits `lesson_added` RunStore event when a run is active
- `src/commands/lessons.ts` - `buddy lessons` CLI: `list [--category]`, `add <content> --category`, `search <query>`, `clear [--category]`, `context`, `stats`, `export [--format md|json|csv] [--output <file>]`, `decay [--days N] [--dry-run]`
- `src/commands/handlers/lessons-handler.ts` - Handler for `/lessons` slash command in Ink UI; subcommands: `list`, `add <content>`, `search <query>`, `stats`
- `src/context/restorable-compression.ts` - Manus AI restorable compression: extracts file/URL/tool-call-ID identifiers from dropped messages, stores full content, `restore(identifier)` → content; `getRestorableCompressor()` singleton; eviction at 10 MB; `writeToolResult(callId, content)` persists full tool outputs to `.codebuddy/tool-results/<callId>.txt` for disk-backed dual-representation
- `src/context/observation-variator.ts` - Manus AI anti-repetition: rotates 3 tool-result presentation templates and 3 memory-block phrasings per agent turn using `turnIndex % N`; `getObservationVariator()` singleton; integrated in `agent-executor.ts` (both paths)
- `src/security/shell-env-policy.ts` - Codex-inspired subprocess env control: `ShellEnvPolicy` with `inherit`/`exclude`/`include_only`/`set` config; strips credential-like vars by default; configurable via `[shell_env]` in config.toml; `getShellEnvPolicy()` singleton
- `src/context/precompaction-flush.ts` - OpenClaw NO_REPLY flush: silent LLM turn before context compaction saves durable facts to MEMORY.md; `NO_REPLY` sentinel (≤ 300 chars) suppresses output; triggered from both agent-executor paths when `shouldWarn()` fires
- `src/tools/registry/attention-tools.ts` - Registers `todo_update` (add/complete/update/remove/clear_done/list) + `restore_context` tools; `createAttentionTools()` factory
- `src/commands/todos.ts` - `buddy todo` CLI: `list`, `add <text>`, `done <id>`, `update <id>`, `remove <id>`, `clear-done`, `context`
- `src/daemon/daily-reset.ts` - OpenClaw daily context boundary: clears message history at configurable hour (default 04:00), preserves MEMORY.md/files, posts a boundary marker; `getDailyResetManager()` singleton started by daemon
- `src/prompts/variation-injector.ts` - Manus AI structured variation: shuffles guideline blocks + applies phrasing alternatives with day-scoped seed (stable within a day for KV cache, rotates across days); integrated in `PromptBuilder.buildSystemPrompt()`
- `src/config/toml-config.ts` - named config profiles: `[profiles.<name>]` sections in config.toml deep-merged over base config; `ConfigManager.applyProfile(name)` + `buddy --profile <name>` CLI flag
- `src/context/enhanced-compression.ts` - Fixed `detectContentType()` to classify failed tool results (`"success": false`) as `'error'` type so `preserveErrors: true` actually retains them during compaction
- `src/sandbox/os-sandbox.ts` - `SandboxMode` enum (`read-only | workspace-write | danger-full-access`); `getWorkspaceRoot(cwd)` via git; `createSandboxConfigForMode(mode, cwd)` / `createSandboxForMode(mode)` factory; `.git/.codebuddy` always read-only in workspace-write mode
- `src/tools/bash/bash-tool.ts` - `BashTool.shellFreeExec(argv, timeout?, cwd?)` — Codex shell-free exec via `spawn({ shell: false })` on pre-parsed argv token array (prevents shell injection)
- `src/channels/streaming-policy.ts` - Per-channel streaming policies: `ChannelStreamingPolicy` interface, `StreamingChunker` class, built-in defaults for Telegram/Discord/Slack/WhatsApp/Signal/Matrix/WebChat/Teams; `setChannelPolicy(id, policy)` / `getChannelPolicy(id)` registry
- `src/security/ssrf-guard.ts` - SSRF guard with IPv4 (octal/hex/short) + IPv6 (NAT64/6to4/Teredo/IPv4-mapped) bypass blocking; async `isSafeUrl(url)` with DNS resolution; `assertSafeUrl(url)` throws `SSRFError`; integrated into `FetchTool`
- `src/utils/stable-json.ts` - Stable (key-sorted) JSON serialization: `stableStringify(value)` + `normalizeJson(json)` for KV-cache-friendly prompt segments
- `src/optimization/cache-breakpoints.ts` - Anthropic prompt cache breakpoints: `buildStableDynamicSplit()`, `injectAnthropicCacheBreakpoints(messages)` — 10× cost saving on cached prompt prefix
- `src/agent/response-constraint.ts` - Response prefill modes: `ResponseConstraint` (auto/required/specified), `ResponseConstraintStack`, `resolveToolChoice()` → OpenAI `tool_choice`; integrated in agent-executor (both paths)
- `src/sandbox/execpolicy.ts` - Extended with `PrefixRule` (token-array exact-prefix matching), `addPrefixRule()`, `evaluateArgv()` — prefix rules checked before regex/glob rules
- `src/commands/execpolicy.ts` - `buddy execpolicy` CLI: `check`, `check-argv`, `list`, `list-prefix`, `add-prefix`, `show-dangerous`, `dashboard`
- `src/observability/run-store.ts` - `forkRun(parentRunId, reason)` for session fork/rollout unification; `RunMetadata.parentRolloutId` + `forkReason` for lineage tracking
- `src/tools/registry/tool-aliases.ts` - Codex-style canonical tool aliases (`shell_exec`, `file_read`, `browser_search`, etc.); `createAliasTools(primaryTools)` wrappers; `toCanonicalName()` / `toLegacyName()` / `TOOL_ALIASES` / `CANONICAL_NAME` maps; registered in `createAllToolsAsync()`

### Tool Implementation Pattern

Tools are in `src/tools/`. Each tool exports a class with methods returning `Promise<ToolResult>`:

```typescript
interface ToolResult {
  success: boolean;
  output?: string;
  error?: string;
}
```

To add a new tool:
1. Create tool class in `src/tools/`
2. Add tool definition in `src/codebuddy/tools.ts` (OpenAI function calling format)
3. Add execution case in `CodeBuddyAgent.executeTool()`

### Plugin System

Plugins can extend Code Buddy with custom tools, commands, and providers:

```typescript
// Plugin types
type PluginProviderType = 'llm' | 'embedding' | 'search';

interface PluginProvider {
  id: string;
  name: string;
  type: PluginProviderType;
  priority?: number;
  initialize(): Promise<void>;
  // LLM methods
  chat?(messages: LLMMessage[]): Promise<string>;
  // Embedding methods
  embed?(text: string | string[]): Promise<number[] | number[][]>;
  // Search methods
  search?(query: string, options?: SearchOptions): Promise<SearchResult[]>;
}
```

Plugin locations:
- `~/.codebuddy/plugins/` - User plugins
- `.codebuddy/plugins/` - Project plugins

### Stream Handling

Use stream helpers for consistent error handling:

```typescript
import { withStreamTimeout, safeStreamRead, handleStreamError } from './utils/stream-helpers.js';

// With timeout
for await (const chunk of withStreamTimeout(stream, { timeoutMs: 30000 })) {
  process.stdout.write(chunk);
}

// Safe read with result
const result = await safeStreamRead(reader, { context: 'OllamaStream' });
if (!result.success) {
  handleStreamError(result.error!, { source: 'OllamaProvider' });
}
```

### Input Validation

Use validators for user input:

```typescript
import { validateFilePath, validateCommand, validateUrl } from './utils/validators.js';

const pathResult = validateFilePath(userPath, { allowAbsolute: true });
if (!pathResult.ok) {
  return { error: pathResult.error.message };
}
const safePath = pathResult.value;
```

### Special Modes

- **YOLO Mode** (`YOLO_MODE=true` + `/yolo on`) - 400 tool rounds, $100 cost limit, auto-approve edits/commands with guardrails
  - Key files: `src/utils/autonomy-manager.ts` (YOLOConfig, allow/deny lists, session tracking), `src/commands/handlers/core-handlers.ts` (/yolo handler)
  - Commands: `/yolo on|off|safe|status|allow|deny`, `/autonomy suggest|confirm|auto|full|yolo`
  - Guardrails: blocked paths (`.env`, `.git`, `*.pem`), blocked commands (`rm -rf /`, `sudo`, `DROP DATABASE`), per-session limits
- **Security Modes** - Three tiers: `suggest` (confirm all), `auto-edit` (auto-approve safe), `full-auto`
- **Agent Modes** - `plan`, `code`, `ask`, `architect` - each restricts available tools

## Coding Conventions

- TypeScript strict mode, avoid `any`
- Single quotes, semicolons, 2-space indent
- Files: kebab-case (`text-editor.ts`)
- Components: PascalCase (`ChatInterface.tsx`)
- Commit messages: Conventional Commits (`feat(scope): description`)

## Environment Variables

| Variable | Description | Default |
|:---------|:------------|:--------|
| `GROK_API_KEY` | Required API key from x.ai | - |
| `MORPH_API_KEY` | Optional, enables fast file editing | - |
| `YOLO_MODE` | Full autonomy mode (requires `/yolo on`) | `false` |
| `MAX_COST` | Session cost limit in dollars | `$10` (YOLO: `$100`) |
| `GROK_BASE_URL` | Custom API endpoint | - |
| `GROK_MODEL` | Default model to use | - |
| `JWT_SECRET` | Secret for API server auth | Required in production |
| `PICOVOICE_ACCESS_KEY` | Picovoice key for Porcupine wake word detection | Optional (text-match fallback) |
| `BRAVE_API_KEY` | Brave Search API key for MCP web search | Optional |
| `EXA_API_KEY` | Exa neural search API key for MCP | Optional |
| `PERPLEXITY_API_KEY` | Perplexity AI search key (direct or via OpenRouter) | Optional |
| `OPENROUTER_API_KEY` | OpenRouter key (alternative for Perplexity) | Optional |
| `PERPLEXITY_MODEL` | Perplexity model to use | `perplexity/sonar-pro` |
| `CACHE_TRACE` | Enable prompt construction debug tracing | `false` |

## HTTP Server

The server (`src/server/`) provides REST and WebSocket APIs:

### Key Endpoints
- `GET /api/health` - Health check
- `GET /api/metrics` - Prometheus metrics
- `POST /api/chat` - Chat completion
- `POST /api/chat/completions` - OpenAI-compatible endpoint
- `GET /api/tools` - List tools
- `POST /api/tools/:name/execute` - Execute tool
- `GET/POST /api/sessions` - Session management
- `GET/POST /api/memory` - Memory management
- `GET /api/daemon/status` - Daemon status
- `GET /api/daemon/health` - Health metrics (CPU, memory)
- `GET /api/cron/jobs` - List cron jobs
- `POST /api/cron/jobs/:id/trigger` - Trigger a cron job manually
- `GET/POST /api/notifications/preferences` - Notification preferences
- `GET/POST /api/heartbeat/status|start|stop|tick` - Heartbeat engine control
- `GET /api/hub/search?q=...` - Skills hub search
- `GET /api/hub/installed` - List installed hub skills
- `POST /api/hub/install` - Install a skill from hub
- `DELETE /api/hub/:name` - Uninstall a hub skill
- `GET /api/identity` - List loaded identity files
- `GET /api/identity/prompt` - Get combined identity prompt
- `PUT /api/identity/:name` - Update an identity file
- `GET /api/groups/status|list` - Group security status/config
- `POST /api/groups/block` - Block a user globally
- `DELETE /api/groups/block/:userId` - Unblock a user
- `GET/POST/DELETE /api/auth-profiles` - Auth profile CRUD
- `POST /api/auth-profiles/reset` - Reset all profile cooldowns

### WebSocket Events
- `authenticate` - JWT authentication
- `chat_stream` - Streaming chat
- `tool_execute` - Tool execution
- `ping/pong` - Keep-alive

### Configuration
```typescript
interface ServerConfig {
  port: number;              // Default: 3000
  host: string;              // Default: '0.0.0.0'
  cors: boolean;             // Default: true
  rateLimit: boolean;        // Default: true
  rateLimitMax: number;      // Default: 100 req/min
  authEnabled: boolean;      // Default: true
  websocketEnabled: boolean; // Default: true
}
```
