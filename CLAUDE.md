# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
npm install          # Install dependencies
npm run dev          # Development mode with Bun (bun run src/index.ts)
npm run dev:node     # Development mode with tsx
npm run build        # Build with TypeScript (tsc)
npm start            # Run built CLI (node dist/index.js)
npm run dev -- -d /path  # Run with specific working directory
```

## Testing

```bash
npm test             # Run tests with Jest
npm run test:watch   # Watch mode
npm run test:coverage # Run with coverage report
```

## Code Quality

```bash
npm run lint         # ESLint
npm run lint:fix     # Auto-fix lint issues
npm run format       # Prettier format
npm run typecheck    # TypeScript type checking
npm run validate     # Run lint + typecheck + test
```

## Architecture Overview

Grok CLI is an AI-powered terminal agent that uses the Grok API (xAI) via OpenAI SDK. It implements an agentic loop where the AI autonomously uses tools to accomplish tasks.

### Core Flow

```
User Input → ChatInterface (Ink/React) → GrokAgent → Grok API
                                              ↓
                                         Tool Calls
                                              ↓
                                    Tool Execution + Confirmation
                                              ↓
                                      Results back to API
```

### Key Directories

- **src/agent/** - Core agent logic, multi-agent system, reasoning (Tree-of-Thought/MCTS), auto-repair engine
  - **src/agent/repair/** - Iterative repair engine with test feedback loop (ChatRepair-inspired)
  - **src/agent/multi-agent/** - Multi-agent coordination with adaptive task allocation
  - **src/agent/specialized/** - Specialized agents for PDF, Excel, SQL, archives, data analysis, security
    - **src/agent/specialized/security-review-agent.ts** - OWASP-based security scanning agent
  - **src/agent/thinking-keywords.ts** - Extended thinking triggers (think/megathink/ultrathink)
- **src/tools/** - Tool implementations (file ops, bash, search, multi-edit) and code intelligence suite
  - **src/tools/enhanced-search.ts** - High-performance search with bundled ripgrep, symbol search, LRU caching
- **src/tools/intelligence/** - AST parser, symbol search, dependency analyzer, refactoring assistant
- **src/ui/** - Terminal UI components using React 18 + Ink 4
  - **src/ui/components/error-boundary.tsx** - React error boundaries for crash resilience
- **src/grok/** - Grok API client wrapper and tool definitions
- **src/context/** - Codebase RAG, semantic mapping, context management
  - **src/context/context-compressor.ts** - Intelligent context compression (JetBrains research)
  - **src/context/dependency-aware-rag.ts** - RAG with dependency graph integration (CodeRAG)
  - **src/context/observation-masking.ts** - Tool output masking for irrelevant results
  - **src/context/cross-encoder-reranker.ts** - Cross-encoder reranking for improved RAG precision
  - **src/context/web-search-grounding.ts** - Web search integration (DuckDuckGo, Brave, Google)
- **src/renderers/** - Specialized output renderers for structured data display
  - **src/renderers/render-manager.ts** - Central render orchestration with type detection
  - **src/renderers/specialized/** - Test results, weather, code structure renderers
- **src/performance/** - Performance optimization module
  - **src/performance/performance-manager.ts** - Central performance orchestrator
  - **src/performance/lazy-loader.ts** - Lazy loading for heavy modules
  - **src/performance/tool-cache.ts** - Semantic caching for tool calls
  - **src/performance/request-optimizer.ts** - Request batching and deduplication
- **src/security/** - Security and permission systems
  - **src/security/index.ts** - Unified security manager
  - **src/security/approval-modes.ts** - Three-tier approval system (read-only/auto/full-access)
  - **src/security/data-redaction.ts** - Automatic sensitive data masking
- **src/optimization/** - Research-based LLM optimizations
  - **src/optimization/tool-filtering.ts** - Dynamic tool filtering (Less-is-More research)
  - **src/optimization/model-routing.ts** - Tiered model routing (FrugalGPT)
  - **src/optimization/parallel-executor.ts** - Parallel tool execution (LLMCompiler)
  - **src/optimization/latency-optimizer.ts** - Latency optimization for flow state
- **src/mcp/** - Model Context Protocol integration
- **src/hooks/** - Event hooks system (PreToolUse, PostToolUse, etc.)
- **src/memory/** - Persistent memory system (4 types: episodic, semantic, procedural, prospective)
  - **src/memory/prospective-memory.ts** - Goal-oriented memory for tasks, goals, and reminders
  - **src/memory/enhanced-memory.ts** - Unified memory with vector embeddings
- **src/database/** - SQLite database for persistent storage
  - **src/database/schema.ts** - Database schema with 14 tables (memories, sessions, tasks, goals, etc.)
  - **src/database/database-manager.ts** - Connection management, migrations, WAL mode
  - **src/database/repositories/** - Repository pattern for each entity
  - **src/database/migration.ts** - JSON to SQLite migration utility
  - **src/database/integration.ts** - High-level API for database operations
- **src/embeddings/** - Vector embeddings for semantic search
  - **src/embeddings/embedding-provider.ts** - Local (transformers.js) or API-based embeddings
- **src/learning/** - Persistent learning system
  - **src/learning/persistent-learning.ts** - Repair strategies, conventions, tool effectiveness
- **src/analytics/** - Analytics and cost tracking
  - **src/analytics/persistent-analytics.ts** - Budget tracking, usage trends, cost alerts
- **src/skills/** - Auto-activating specialized abilities
- **src/utils/** - Utility modules
  - **src/utils/semantic-cache.ts** - Semantic API response caching (68% API reduction)
  - **src/utils/shell-completions.ts** - Bash/zsh/fish completion scripts
- **src/commands/** - Slash commands system (40+ commands: /help, /model, /commit, etc.)
  - **src/commands/slash-commands.ts** - Core slash command dispatcher
  - **src/commands/handlers/** - Individual command implementations
- **src/browser/** - Embedded browser UI with Puppeteer for visual rendering
- **src/checkpoints/** - File checkpoint system for undo/restore operations
  - **src/checkpoints/checkpoint-manager.ts** - Snapshot management and rollback
- **src/collaboration/** - Multi-user collaboration features
- **src/config/** - Application configuration and constants
  - **src/config/grokrules.ts** - Project-specific AI behavior rules (.grokrules files)
- **src/input/** - User input handling, voice, and multimodal
  - **src/input/input-handler.ts** - Keyboard input processing
  - **src/input/voice-input.ts** - Voice input with speech-to-text (Whisper, Deepgram)
  - **src/input/multimodal-input.ts** - Image/screenshot input with OCR support
- **src/integrations/** - External service integrations (GitHub, IDE)
  - **src/integrations/github-actions.ts** - GitHub Actions workflow management
  - **src/integrations/ide-extensions.ts** - IDE extensions server (VS Code, Neovim, JetBrains)
- **src/lsp/** - Language Server Protocol integration for IDE features
- **src/modes/** - Agent operation modes (plan, code, ask, architect)
- **src/observability/** - Monitoring and debugging dashboard
  - **src/observability/dashboard.ts** - Real-time system monitoring
- **src/offline/** - Offline mode with local LLM support
- **src/persistence/** - Session persistence and export
  - **src/persistence/session-store.ts** - Session state management
- **src/personas/** - AI personality customization
- **src/plugins/** - Plugin system and marketplace
- **src/providers/** - Model provider abstractions (Grok, OpenAI, local)
- **src/sandbox/** - Sandboxed execution environments
  - **src/sandbox/os-sandbox.ts** - OS-level sandboxing (bubblewrap for Linux, seatbelt for macOS)
  - **src/sandbox/execpolicy.ts** - Command authorization framework with rule-based policies
  - **src/sandbox/docker-sandbox.ts** - Docker-based sandboxed execution
- **src/services/** - Business logic services
  - **src/services/plan-generator.ts** - Plan mode implementation
- **src/tasks/** - Background task management
- **src/templates/** - Prompt templates for various operations
- **src/testing/** - Test utilities and helpers
- **src/themes/** - UI theming system
- **src/undo/** - Undo/redo functionality for file operations

### Key Patterns

- **Singleton**: ConfirmationService, Settings management
- **Event Emitter**: Confirmation flow, UI updates
- **Async Iterator**: Streaming responses from API
- **Strategy**: Tool implementations, search backends (ripgrep vs fuzzy)

### Important Classes

- `GrokAgent` (src/agent/grok-agent.ts) - Main orchestrator, handles agentic loop (max 30 rounds)
- `ConfirmationService` (src/utils/confirmation-service.ts) - Centralized confirmation for destructive ops
- `GrokClient` (src/grok/) - OpenAI SDK wrapper for Grok API
- `ContextCompressor` (src/context/context-compressor.ts) - Intelligent context compression with priority-based retention
- `IterativeRepairEngine` (src/agent/repair/iterative-repair.ts) - ChatRepair-style repair with test feedback
- `DependencyAwareRAG` (src/context/dependency-aware-rag.ts) - RAG enhanced with dependency graph
- `ObservationMasker` (src/context/observation-masking.ts) - Tool output masking for irrelevant results
- `EnhancedCoordinator` (src/agent/multi-agent/enhanced-coordination.ts) - Adaptive multi-agent coordination
- `EnhancedSearch` (src/tools/enhanced-search.ts) - Streaming search with symbol/reference finding
- `ThinkingKeywordsManager` (src/agent/thinking-keywords.ts) - Detects think/megathink/ultrathink keywords
- `ApprovalModeManager` (src/security/approval-modes.ts) - Three-tier permission system (read-only/auto/full-access)
- `SemanticCache` (src/utils/semantic-cache.ts) - API response caching with cosine similarity matching
- `ErrorBoundary` (src/ui/components/error-boundary.tsx) - React error boundaries for UI crash resilience
- `RenderManager` (src/renderers/render-manager.ts) - Orchestrates specialized output renderers
- `PerformanceManager` (src/performance/performance-manager.ts) - Central performance optimization
- `SecurityManager` (src/security/index.ts) - Unified security layer with approval, sandbox, redaction
- `AgentRegistry` (src/agent/specialized/agent-registry.ts) - Registry for specialized file processing agents
- `ModelRouter` (src/optimization/model-routing.ts) - Tiered model routing for cost optimization (FrugalGPT)
- `ParallelExecutor` (src/optimization/parallel-executor.ts) - Parallel tool execution with dependency analysis
- `LatencyOptimizer` (src/optimization/latency-optimizer.ts) - Latency tracking and caching for flow state
- `DatabaseManager` (src/database/database-manager.ts) - SQLite connection with WAL mode and migrations
- `DatabaseIntegration` (src/database/integration.ts) - Unified API for all database operations
- `EmbeddingProvider` (src/embeddings/embedding-provider.ts) - Vector embeddings (local/API/mock)
- `PersistentLearning` (src/learning/persistent-learning.ts) - Continuous learning from repairs and tools
- `PersistentAnalytics` (src/analytics/persistent-analytics.ts) - Cost tracking with budget alerts
- `ProspectiveMemory` (src/memory/prospective-memory.ts) - Goal-oriented task/reminder management
- `CrossEncoderReranker` (src/context/cross-encoder-reranker.ts) - Cross-encoder reranking for RAG (+15% precision)
- `OSSandbox` (src/sandbox/os-sandbox.ts) - OS-level sandboxing with bubblewrap/seatbelt backends
- `ExecPolicy` (src/sandbox/execpolicy.ts) - Command authorization with rule-based policies
- `SecurityReviewAgent` (src/agent/specialized/security-review-agent.ts) - OWASP-based security scanning
- `GitHubActionsManager` (src/integrations/github-actions.ts) - GitHub Actions workflow management
- `IDEExtensionsServer` (src/integrations/ide-extensions.ts) - IDE extensions TCP server
- `MultimodalInputManager` (src/input/multimodal-input.ts) - Image/screenshot input handling
- `WebSearchManager` (src/context/web-search-grounding.ts) - Web search grounding for context
- `GrokRulesManager` (src/config/grokrules.ts) - Project-specific AI behavior configuration

### Research-Based Improvements

Based on recent scientific publications in AI-assisted software development:

| Feature | Research Basis | Improvement |
|---------|---------------|-------------|
| Context Compression | JetBrains 2024 | -7% costs, +2.6% success rate |
| Iterative Repair | ChatRepair (ISSTA 2024) | Feedback-driven repair loop |
| Dependency-Aware RAG | CodeRAG 2024 | Repo-level context with dependency graph |
| Observation Masking | JetBrains/AgentCoder | Semantic relevance filtering |
| Adaptive Coordination | AgentCoder/RepairAgent | Performance-based task allocation |
| Semantic Caching | API optimization research | 68% API call reduction |
| Thinking Keywords | Claude Code patterns | Variable token budgets (4K/10K/32K) |
| Approval Modes | Codex CLI security model | Three-tier permission system |
| Specialized Renderers | Output formatting | Structured display for test/weather/code |
| Lazy Loading | Performance optimization | On-demand heavy module loading |
| Request Batching | API optimization | Deduplication and retry logic |
| Dynamic Tool Filtering | Less-is-More (arXiv 2024) | 70% execution time reduction |
| Model Tier Routing | FrugalGPT (Stanford) | 30-70% cost reduction |
| Parallel Tool Execution | LLMCompiler/AsyncLM | 2.5-4.6x speedup |
| Latency Optimization | Replit/Human-AI research | Sub-500ms for flow state |
| SQLite Persistence | Best practices | Reliable data storage with WAL mode |
| Vector Embeddings | Sentence transformers | Real semantic search (384-dim) |
| Persistent Learning | ML best practices | Continuous improvement from feedback |
| Cross-Encoder Reranking | Sentence-BERT research | +15% precision on RAG results |
| Prospective Memory | MemGPT (UC Berkeley) | Goal/task management with triggers |
| OS-Level Sandboxing | Codex CLI/Claude Code | Secure command execution (bubblewrap/seatbelt) |
| Web Search Grounding | Gemini CLI patterns | Real-time web search for context |
| Project Rules | Cursor .cursorrules | Project-specific AI behavior (.grokrules) |
| Security Scanning | OWASP Top 10 | Automated vulnerability detection |
| IDE Extensions | Continue/Cursor | VS Code, Neovim, JetBrains integration |
| Multimodal Input | Claude Code patterns | Screenshot/image input with OCR |

### Database System

SQLite-based persistence with the following tables:

| Table | Purpose |
|-------|---------|
| `memories` | Long-term memory with vector embeddings for semantic search |
| `sessions` | Conversation sessions with cost tracking |
| `messages` | Individual messages within sessions |
| `code_embeddings` | Vector embeddings for code chunks (semantic code search) |
| `tool_stats` | Tool usage statistics and success rates |
| `repair_learning` | What repair strategies work for which error patterns |
| `analytics` | Daily aggregated usage and cost data |
| `conventions` | Learned coding conventions per project |
| `checkpoints` | File checkpoints for undo/restore |
| `checkpoint_files` | Individual file snapshots |
| `cache` | General-purpose cache with TTL |
| `prospective_tasks` | Future tasks with triggers and dependencies |
| `goals` | Long-term objectives composed of tasks |
| `reminders` | Contextual and time-based reminders |

Key features:
- **WAL mode** for better concurrency
- **Vector embeddings** for semantic search (local or API-based)
- **Automatic migration** from JSON files
- **Repository pattern** for clean data access
- **Budget alerts** when costs exceed limits

### Slash Commands

Key interactive commands available during sessions:

| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
| `/model [name]` | Switch AI model |
| `/mode <plan\|code\|ask>` | Change agent mode |
| `/stats [action]` | Performance statistics (summary/cache/requests/reset) |
| `/security [action]` | Security dashboard (status/mode/events/reset) |
| `/security-review [path]` | Run OWASP-based security scan on code |
| `/cost [action]` | Cost tracking (status/budget/daily/export/reset) |
| `/commit` | Generate and create git commit |
| `/review` | Code review of current changes |
| `/test` | Run and analyze tests |
| `/explain [file]` | Explain code |
| `/gha [action]` | GitHub Actions workflow management |
| `/image [path]` | Load image for multimodal input |
| `/search [query]` | Web search for grounding context |
| `/clear` | Clear chat history |

### Configuration Files

- `.grok/settings.json` - Project settings
- `~/.grok/user-settings.json` - User settings
- `~/.grok/grok.db` - SQLite database (memories, sessions, analytics, etc.)
- `~/.grok/models/` - Local embedding models cache
- `.grok/hooks.json` - Event hooks
- `.grok/mcp.json` - MCP server configuration
- `.grok/approval-mode.json` - Current approval mode
- `.grok/cache/semantic-cache.json` - Cached API responses (legacy, migrated to DB)
- `.grok/cache/tool-cache.json` - Cached tool results (legacy, migrated to DB)
- `.grokrules` or `.grokrules.json` - Project-specific AI behavior rules (like .cursorrules)
- `.grok/execpolicy.json` - Command authorization rules and policies

## Coding Conventions

- TypeScript strict mode, avoid `any`
- Single quotes, semicolons, 2-space indent
- Files: kebab-case (`text-editor.ts`)
- Components: PascalCase (`ChatInterface.tsx`)
- Functions: camelCase
- Constants: UPPER_SNAKE_CASE
- Commit messages: Conventional Commits format (`feat(scope): description`)

## Environment Variables

- `GROK_API_KEY` - Required API key from x.ai
- `MORPH_API_KEY` - Optional, enables fast file editing (4500+ tokens/sec)
- `YOLO_MODE=true` - Full autonomy mode (400 tool rounds, no cost limit)
- `MAX_COST` - Session cost limit (default $10)
