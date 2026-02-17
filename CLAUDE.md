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

Code Buddy is an open-source multi-provider AI coding agent that runs in the terminal. It supports multiple LLM backends (Grok, Claude, ChatGPT, Gemini, Ollama, LM Studio) via OpenAI-compatible APIs and provider-specific SDKs. The core pattern is an **agentic loop** where the AI autonomously calls tools to complete tasks. It features multi-channel messaging (Telegram, Discord, Slack), a SKILL.md natural language skills system, pipeline workflows, DM pairing security, OpenClaw-inspired concurrency control, daemon mode for 24/7 background operation, DAG-based task planning, screen observation with event triggers, proactive agent communication, multi-agent orchestration with self-healing, voice conversation with multi-provider TTS (Edge TTS, OpenAI, ElevenLabs, AudioReader/Kokoro-82M), Gemini vision support (image_url → inlineData conversion), model failover chain, webhook triggers, Docker sandbox, skills registry with 40 bundled SKILL.md files, media pipeline, ACP inter-agent protocol, extension system, live canvas (A2UI), copilot proxy, and onboarding wizard + doctor diagnostics.

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
- `src/agent/turn-diff-tracker.ts` - Per-turn file change tracking with rollback support
- `src/agent/history-repair.ts` - Message history self-repair (fixes orphaned tool results, malformed sequences)
- `src/agent/cache-trace.ts` - Prompt construction debugging (enable via `CACHE_TRACE=true`)
- `src/config/model-tools.ts` - Per-model tool configuration (capabilities, context window, patch format)
- `src/utils/head-tail-truncation.ts` - Head/tail output truncation (keeps start+end of large outputs)
- `src/persistence/session-lock.ts` - PID-based session file locking (prevents concurrent writes)
- `src/security/skill-scanner.ts` - Static analysis of skill files for dangerous patterns
- `src/security/bash-parser.ts` - AST-based bash command parsing (tree-sitter with regex fallback)
- `src/utils/rtk-compressor.ts` - RTK binary integration for bash output compression (60-90% token reduction)
- `src/memory/icm-bridge.ts` - ICM MCP server bridge for persistent cross-session memory

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

- **YOLO Mode** (`YOLO_MODE=true`) - 400 tool rounds, higher cost limit, full autonomy
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
