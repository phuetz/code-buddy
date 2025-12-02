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
- **src/tools/** - Tool implementations (file ops, bash, search, multi-edit) and code intelligence suite
- **src/tools/intelligence/** - AST parser, symbol search, dependency analyzer, refactoring assistant
- **src/ui/** - Terminal UI components using React 18 + Ink 4
- **src/grok/** - Grok API client wrapper and tool definitions
- **src/context/** - Codebase RAG, semantic mapping, context management
- **src/mcp/** - Model Context Protocol integration
- **src/hooks/** - Event hooks system (PreToolUse, PostToolUse, etc.)
- **src/memory/** - Persistent memory system
- **src/skills/** - Auto-activating specialized abilities

### Key Patterns

- **Singleton**: ConfirmationService, Settings management
- **Event Emitter**: Confirmation flow, UI updates
- **Async Iterator**: Streaming responses from API
- **Strategy**: Tool implementations, search backends (ripgrep vs fuzzy)

### Important Classes

- `GrokAgent` (src/agent/grok-agent.ts) - Main orchestrator, handles agentic loop (max 30 rounds)
- `ConfirmationService` (src/utils/confirmation-service.ts) - Centralized confirmation for destructive ops
- `GrokClient` (src/grok/) - OpenAI SDK wrapper for Grok API

### Configuration Files

- `.grok/settings.json` - Project settings
- `~/.grok/user-settings.json` - User settings
- `.grok/hooks.json` - Event hooks
- `.grok/mcp.json` - MCP server configuration

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
