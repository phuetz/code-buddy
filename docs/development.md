# Development

## Build Commands

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

Tests use **Vitest** with happy-dom. The `vitest.setup.ts` shims `globalThis.jest` to `vi`, so legacy `jest.fn()` / `jest.spyOn()` calls work in tests.

**27,334 tests** across 600+ suites covering all subsystems.

## Architecture Overview

### Core Flow

```
User Input -> ChatInterface (Ink/React) -> CodeBuddyAgent -> LLM Provider
                                                |
                                       Tool Calls (max 50/400 rounds)
                                                |
                                      Tool Execution + Confirmation
                                                |
                                         Results -> API (loop)
```

### Facade Architecture

```
CodeBuddyAgent
  |-- AgentContextFacade       Token counting, context compression, memory
  |-- SessionFacade            Save/load sessions, checkpoints, rewind
  |-- ModelRoutingFacade       Model selection, cost tracking, usage stats
  |-- InfrastructureFacade     MCP servers, sandbox, hooks, plugins
  +-- MessageHistoryManager    Message storage, history truncation, export
```

### Middleware Pipeline

Composable before/after turn hooks with priorities:

| Middleware | Priority | Purpose |
|:-----------|:---------|:--------|
| ReasoningMiddleware | 42 | Auto-detect complex queries, inject reasoning guidance |
| WorkflowGuardMiddleware | 45 | Suggest plan init for complex first messages |
| AutoRepairMiddleware | 150 | Detect errors, invoke fault localizer, suggest repairs |
| QualityGateMiddleware | 200 | Auto-delegate to CodeGuardian and SecurityReview agents |

### Key Entry Points

| File | Purpose |
|:-----|:--------|
| `src/index.ts` | CLI entry (Commander), lazy-loaded commands |
| `src/agent/codebuddy-agent.ts` | Main agentic loop, `executePlan()` |
| `src/agent/execution/agent-executor.ts` | Middleware pipeline, reasoning, tool streaming |
| `src/codebuddy/client.ts` | LLM API client (multi-provider) |
| `src/services/prompt-builder.ts` | System prompt builder |
| `src/codebuddy/tools.ts` | Tool definitions + RAG selection |
| `src/ui/components/ChatInterface.tsx` | React/Ink terminal UI |

## Coding Conventions

- TypeScript strict mode, avoid `any`
- Single quotes, semicolons, 2-space indent
- Files: kebab-case (`text-editor.ts`), components: PascalCase (`ChatInterface.tsx`)
- Commit messages: Conventional Commits (`feat(scope): description`)
- ESM imports require `.js` extension even for `.ts` source files
- Use `logger` (from `src/utils/logger.js`) not `console.warn/error` in production code
- The `@` alias maps to `./src` (configured in `vitest.config.ts`)

## Adding a New Tool

1. Create a class in `src/tools/`
2. Add a definition in `src/codebuddy/tools.ts` (OpenAI function calling format)
3. Add an execution case in `CodeBuddyAgent.executeTool()`
4. Register in `src/tools/registry/` via the appropriate factory
5. Add metadata in `src/tools/metadata.ts` (keywords, priority for RAG selection)

Tool aliases can be defined in `src/tools/registry/tool-aliases.ts`.

## Key Design Decisions

1. **Lazy Loading** -- Heavy modules loaded on-demand. Enable profiling with `PERF_TIMING=true`.
2. **Model-Aware Limits** -- `src/config/model-tools.ts` defines per-model capabilities with glob matching.
3. **RAG Tool Selection** -- Tools filtered per query to reduce prompt tokens.
4. **Context Compression** -- `ContextManagerV2` uses sliding window + summarization.
5. **ESM** -- The project is `"type": "module"`. Use `import.meta.url` with `fileURLToPath` for `__dirname` equivalents.

## Testing Gotchas

- `BashTool` tests require `ConfirmationService.setSessionFlag('bashCommands', true)`
- `BashTool` unit tests must mock all transitive imports; mock process events deferred with `setImmediate()`
- CLI command tests: use Commander `parseAsync()` + `exitOverride()`, mock `console.log`/`process.exit`
- Mock dynamic imports via virtual modules for channel adapter tests
- Use `vi.hoisted()` for mock variables in `vi.mock()` factories
- The `AgentRegistry` has 9 built-in agents
