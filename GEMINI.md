# Code Buddy - GEMINI Context

## Project Overview

**Code Buddy** (`@phuetz/code-buddy`) is an open-source, multi-provider AI coding agent for the terminal. It acts as both a powerful development tool and a personal assistant, capable of writing code, running commands, and communicating via multiple channels.

### 🧬 Heritage & Evolution
Code Buddy is a modernized, TypeScript-native implementation of the **OpenClaw** architecture, inheriting its robust concurrency control (Lane Queue), security policies, multi-channel messaging, and self-authoring SKILL.md system. It integrates **Open Manus / Manus AI** concepts: CodeAct (dynamic script execution in Docker), persistent planning via `PLAN.md`, AskHuman mid-task clarification, Knowledge injection from Markdown files, and Wide Research (parallel sub-agent workers that decompose a topic, research it concurrently, then synthesize results).

It supports major AI providers including Grok (xAI), Claude (Anthropic), ChatGPT (OpenAI), Gemini (Google), and local models via Ollama and LM Studio.

## Tech Stack

*   **Language:** TypeScript
*   **Runtime:** Node.js (>=18.0.0)
*   **CLI Framework:** Commander.js
*   **UI Framework:** React with Ink (for terminal UI)
*   **API Server:** Express.js
*   **Database:** SQLite (`better-sqlite3`)
*   **Testing:** Jest
*   **Linting/Formatting:** ESLint, Prettier
*   **Package Manager:** npm (or bun)

## Architecture

The project follows a **Facade Architecture** to manage complexity and a modular design for extensibility.

### Core Components

*   **CodeBuddyAgent (`src/agent/codebuddy-agent.ts`):** The central orchestrator. It manages the conversation loop, tool execution, and interaction with AI providers.
*   **Facades:**
    *   `AgentContextFacade`: Manages context window, token counting, and memory retrieval.
    *   `SessionFacade`: Handles session persistence and checkpoints.
    *   `ModelRoutingFacade`: Selects the appropriate AI model and tracks costs.
    *   `InfrastructureFacade`: Manages MCP, sandboxing, hooks, and plugins.
*   **Autonomy Layer:**
    *   `TaskPlanner`: Decomposes complex requests into DAG execution plans.
    *   `SupervisorAgent`: Coordinates multi-agent workflows (sequential/parallel/race/all).
    *   `SelfHealing`: Automatically recovers from errors with checkpoint rollback.
    *   `WideResearchOrchestrator`: Spawns N parallel worker agents for broad topic research, aggregates via LLM.
    *   `KnowledgeManager`: Injects scoped Markdown knowledge into every agent session.
*   **Context Engineering Layer (Manus AI / OpenClaw / Codex patterns):**
    *   `TodoTracker`: Maintains `todo.md`; pending tasks appended at the END of every LLM context turn (attention bias, prevents goal drift).
    *   `RestorableCompressor`: Extracts file/URL identifiers from dropped messages; `restore_context` tool retrieves full content on demand. Disk-backed to `.codebuddy/tool-results/<callId>.txt`.
    *   `PrecompactionFlusher`: Silent NO_REPLY background turn saves durable facts to MEMORY.md before context compaction.
    *   `ObservationVariator`: Rotates 3 tool-result presentation templates per turn (anti-repetition pattern from Manus AI).
    *   `ResponseConstraintStack`: Controls `tool_choice` (auto / required / specified) without removing tools from the list — preserves KV-cache hit rate.
    *   `PromptCacheBreakpoints`: Splits system prompt into stable prefix + dynamic suffix; injects `cache_control: {type: "ephemeral"}` for Anthropic (10× token cost savings).
    *   `StreamingChunker`: Per-channel output chunking with configurable `StreamingMode` (char / line / sentence / paragraph / full) and format per channel.
    *   `SSRFGuard`: Blocks private IPv4 + all IPv6 transition-address bypass vectors on all outbound fetches.
    *   `SandboxMode`: Three OS-sandbox tiers (`read-only`, `workspace-write`, `danger-full-access`) with automatic git workspace root detection.
    *   `ExecPolicy.evaluateArgv()`: Token-array prefix rule matching (longest-prefix-wins) for safer command authorization than regex.
*   **UI (`src/ui/`):** React components using Ink to render the terminal interface.
*   **Server (`src/server/`):** Express application providing a REST API and WebSocket interface.

### Key Directories

*   `src/agent/`: Core agent logic, planning, and reasoning.
    *   `wide-research.ts` — Wide Research orchestrator (parallel sub-agent workers, LLM aggregation).
    *   `repo-profiler.ts` — Repository structure analysis injected into system prompt.
*   `src/channels/`: Implementations for messaging channels (Telegram, Discord, Slack, WhatsApp, Signal, Matrix, Teams, WebChat, etc.).
    *   `src/channels/telegram/` — Enhanced with CI watcher, diff-first formatter, pro formatter, run tracker, scoped auth.
    *   `src/channels/pro/` — Aggregated pro channel features.
*   `src/cli/`: CLI-specific logic and command handling.
*   `src/commands/`: Implementation of specific CLI commands.
    *   `pairing.ts` — `buddy pairing` — DM pairing management CLI.
    *   `knowledge.ts` — `buddy knowledge` — Knowledge base CRUD CLI.
    *   `research/` — `buddy research` — Wide Research CLI frontend.
    *   `dev/` — Developer introspection commands.
    *   `run-cli/` — `buddy run` — Scripted/non-interactive agent invocations.
*   `src/context/`: Context management, RAG, and token optimization.
*   `src/daemon/`: Background service management and process lifecycle.
*   `src/knowledge/`: Knowledge Module — Markdown knowledge files loaded from local, project, and global scopes, injected into system prompt.
    *   `knowledge-manager.ts` — Singleton, YAML frontmatter parsing, `buildContextBlock()`, search/add/remove.
*   `src/mcp/`: Model Context Protocol integration.
*   `src/memory/`: Memory systems (persistent, prospective, episodic).
*   `src/observability/`: Run tracking and analytics.
    *   `run-store.ts` — SQLite-backed run history.
    *   `run-viewer.ts` — CLI and API views for run analytics.
*   `src/plugins/`: Plugin system architecture.
*   `src/providers/`: Integrations with AI providers (Grok, OpenAI, Anthropic, Google, etc.).
*   `src/security/`: Security features, tool policies, bash allowlists, and write policy.
    *   `write-policy.ts` — Fine-grained file write allow/deny rules.
*   `src/skills/`: Skills library and management (bundled, managed, workspace, ClawHub marketplace).
*   `src/tools/`: Implementation of agent tools (file ops, search, bash, etc.).
    *   `run-script-tool.ts` — **CodeAct** execution engine (Python/TS in Docker sandbox).
    *   `plan-tool.ts` — **Persistent Planning** (`PLAN.md` management).
    *   `ask-human-tool.ts` — Pause execution for typed user input (120 s timeout, non-interactive fallback).
    *   `create-skill-tool.ts` — Agent self-authors SKILL.md files to `.codebuddy/skills/workspace/`.
    *   `registry/knowledge-tools.ts` — ITool adapters: `knowledge_search`, `knowledge_add`, `ask_human`, `create_skill`.
    *   `registry/attention-tools.ts` — ITool adapters: `todo_update` (add/complete/update/remove/list todos), `restore_context` (retrieve compressed content by identifier).
*   `src/agent/todo-tracker.ts` — Manus AI todo.md attention bias: singleton per working dir, `buildContextSuffix()` injected at END of every LLM turn.
*   `src/context/restorable-compression.ts` — Identifier extraction (file paths, URLs, tool call IDs) from dropped messages; in-memory store + disk fallback.
*   `src/context/precompaction-flush.ts` — OpenClaw NO_REPLY pattern: silent LLM turn extracts facts to MEMORY.md before context compaction, suppressed if response is short `NO_REPLY`.
*   `src/commands/todos.ts` — `buddy todo` CLI: `list`, `add`, `done`, `update`, `remove`, `clear-done`, `context`.
*   `src/ui/`: Ink-based UI components.
*   `tests/`: Unit and integration tests (Jest).

## Setup & Development

### Installation

```bash
npm install
# or
bun install
```

### Running in Development

```bash
# Run with Bun (fastest)
npm run dev

# Run with Node (tsx)
npm run dev:node

# Run specific command
npm run dev -- --help
```

### Building

```bash
npm run build
```

### Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

### Linting & Formatting

```bash
# Lint code
npm run lint

# Fix linting issues
npm run lint:fix

# Check formatting
npm run format:check

# Fix formatting
npm run format
```

## Conventions

*   **TypeScript:** All new code must be written in TypeScript with strict type checking.
*   **Lazy Loading:** Heavy modules (especially UI and Agent components) should be lazy-loaded in `src/index.ts` to optimize startup performance.
*   **Modular Design:** Use facades and services to encapsulate logic. Avoid monolithic classes.
*   **Testing:** Write unit tests for all new features using Jest. Aim for high coverage.
*   **Error Handling:** Use the `CodeBuddyError` class and standard error handling patterns.
*   **Logging:** Use the centralized `logger` utility (`src/utils/logger.ts`) instead of `console.log`.
*   **Security:** Always validate inputs and use the `ToolPolicy` and `BashAllowlist` for potentially dangerous operations.

## Configuration

*   **`package.json`:** Dependencies and scripts.
*   **`tsconfig.json`:** TypeScript configuration.
*   **`.codebuddy/`:** Local configuration, memory, and skills storage.
*   **`.env`:** Environment variables (API keys, etc.).
