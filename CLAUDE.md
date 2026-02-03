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

Code Buddy is an open-source multi-provider AI coding agent that runs in the terminal. It supports multiple LLM backends (Grok, Claude, ChatGPT, Gemini, Ollama, LM Studio) via OpenAI-compatible APIs and provider-specific SDKs. The core pattern is an **agentic loop** where the AI autonomously calls tools to complete tasks. It features multi-channel messaging (Telegram, Discord, Slack), a SKILL.md natural language skills system, pipeline workflows, DM pairing security, and OpenClaw-inspired concurrency control.

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

- `src/index.ts` - CLI entry, Commander setup, lazy loading
- `src/agent/codebuddy-agent.ts` - Main orchestrator (agentic loop, tool execution)
- `src/agent/facades/` - Facade classes for modular concerns
- `src/codebuddy/client.ts` - LLM API client (multi-provider, OpenAI SDK compatible)
- `src/codebuddy/tools.ts` - Tool definitions and RAG selection
- `src/ui/components/chat-interface.tsx` - React/Ink terminal UI
- `src/server/index.ts` - HTTP/WebSocket API server

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
