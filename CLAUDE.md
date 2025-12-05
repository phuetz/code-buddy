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
- **src/security/** - Security and permission systems
  - **src/security/approval-modes.ts** - Three-tier approval system (read-only/auto/full-access)
- **src/mcp/** - Model Context Protocol integration
- **src/hooks/** - Event hooks system (PreToolUse, PostToolUse, etc.)
- **src/memory/** - Persistent memory system
- **src/skills/** - Auto-activating specialized abilities
- **src/utils/** - Utility modules
  - **src/utils/semantic-cache.ts** - Semantic API response caching (68% API reduction)
  - **src/utils/shell-completions.ts** - Bash/zsh/fish completion scripts

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

### Configuration Files

- `.grok/settings.json` - Project settings
- `~/.grok/user-settings.json` - User settings
- `.grok/hooks.json` - Event hooks
- `.grok/mcp.json` - MCP server configuration
- `.grok/approval-mode.json` - Current approval mode
- `.grok/cache/semantic-cache.json` - Cached API responses

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
