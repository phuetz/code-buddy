# Context Engine

Code Buddy implements advanced context engineering to maintain coherent long sessions within token limits.

## Pluggable Context Engine

The context system (`src/context/context-engine.ts`) provides 7 lifecycle hooks:

1. **bootstrap** -- initialize context at session start
2. **ingest** -- process new messages
3. **assemble** -- build context for model calls
4. **compact** -- compress context when limits approach
5. **afterTurn** -- post-turn cleanup and maintenance
6. **prepareSubagentSpawn** -- prepare context for sub-agent creation
7. **onSubagentEnded** -- process sub-agent results

Plugins can register custom context engines via `PluginContext.registerContextEngine()`. The `ownsCompaction` flag lets plugins control compaction behavior (only trusted plugins can set this).

`DefaultContextEngine` wraps `ContextManagerV2` as the default implementation.

## Context Compression (ContextManagerV2)

`src/context/context-manager-v2.ts` uses a sliding window with summarization:

- Uses `getModelToolConfig(model).contextWindow` for the budget
- Multi-stage compaction: remove stale tool results, summarize older messages, aggressive truncation
- **Importance-weighted window**: `ImportanceScorer` assigns scores 0-1 per message (errors=0.95, decisions=0.90, code=0.70, conversation=0.25). Messages scoring >0.8 are preserved even outside the recent window
- System prompt truncated to `(contextWindow - maxOutputTokens) * 50%`

## Tool Output Masking (Hybrid Backward-Scanned FIFO)

Before each model call, tool result messages are scanned backward:
- Newest ~50K tokens of outputs are protected
- Older outputs are replaced with head/tail previews (10 lines each)
- Only triggers when total prunable content exceeds ~30K tokens
- Exempt tools: `ask_human`, `plan`, `reason`, `terminate`

## Image Content Pruning

`pruneImageContent()` prunes base64 image tool results, keeping the 2 most recent. Saves ~75K tokens per screenshot in long sessions.

## Transcript Repair

Post-compaction cleanup (`src/context/transcript-repair.ts`):
- Removes orphaned tool results (no matching tool_call)
- Injects synthetic results for lost tool_call pairs
- Wired into all `prepareMessages()` call sites in the agent-executor

## Pre-Compaction Memory Flush

Before compaction triggers, a silent background LLM turn extracts durable facts and saves them to `MEMORY.md`. If the model returns `NO_REPLY` with no meaningful content, the output is suppressed entirely (no notification spam).

## Restorable Compression

Before a tool observation is optimized, its raw content is stored at
`.codebuddy/tool-results/<callId>.txt`. The always-available
`restore_context` tool accepts that exact call ID (for example
`restore_context("call_abc123")`) and retrieves the persisted raw observation.
Legacy file-path and URL identifiers extracted during context compaction remain
supported as a fallback.

The same lossless boundary is used by the multi-agent, subagent, SWE and ACP
tool loops: their public tool result remains untouched, while only the copy
inserted into the next LLM prompt may be optimized. SWE and ACP scope
`restore_context` to call IDs produced in the current run/turn. A legacy or
custom subagent that supplies an executor without exposing the
`restore_context` schema still persists its raw result, but deliberately skips
optimization so the model cannot be left with an unrecoverable observation.
ACP file reads persist the complete editor-buffer/disk text before applying
the public `maxToolOutputBytes` display bound. ACP search remains intentionally
bounded upstream (50 matches per file and 200 collected result lines), so its
recoverable copy is exact for the collected observation rather than an
exhaustive snapshot of every workspace match.

## Proactive Compaction

`shouldCompactBeforeToolExec()` estimates token usage per tool and triggers compaction before the tool executes if context overflow is predicted. This prevents mid-tool context overflow.

## Observation Variator

Rotates 3 presentation templates per turn to prevent repetitive patterns in the conversation (anti-repetition).

## JIT Context Discovery

When a tool accesses a file path, the system walks upward from that path to the project root, loading any `CODEBUDDY.md`, `CONTEXT.md`, `INSTRUCTIONS.md`, `AGENTS.md`, or `README.md` files found in the path or `.codebuddy/`/`.claude/` subdirectories. Already-loaded files are tracked to avoid duplication. Max 4KB per discovery.

**@import directives**: `CODEBUDDY.md` files support `@path/to/file` directives that inline referenced files. Recursive to 5 levels with cycle detection.

**Instruction excludes**: `codebuddyMdExcludes` in `.codebuddy/settings.json` takes glob patterns to skip loading instruction files in monorepo subdirectories.

## Per-Turn Context Injection

Each LLM turn automatically injects:
- `<lessons_context>` block **before** the turn (learned patterns from `.codebuddy/lessons.md`)
- `<todo_context>` block **after** the turn (task list from `todo.md` -- end-of-context attention bias)
- `<knowledge>` block in system prompt (domain knowledge from knowledge base)
- `<coding_style>` block in system prompt (auto-detected project conventions)
- `<decisions_context>` block (architectural decisions with rationale)

## Auto-Compact Threshold

Set via `CODEBUDDY_AUTOCOMPACT_PCT` environment variable as a percentage of context window, or use the absolute token threshold default.
