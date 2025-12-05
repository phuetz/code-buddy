# Claude Code (Anthropic)

## Overview

Claude Code is Anthropic's command-line tool for agentic coding, providing a low-level and unopinionated interface that offers close to raw model access without forcing specific workflows. It is designed as a flexible, customizable, scriptable, and safe power tool.

## Key Features

### Agentic Architecture
- **Subagents**: Delegate specialized tasks (e.g., spinning up backend API while main agent builds frontend) enabling parallel development workflows
- **Hooks**: Automatically trigger actions at specific points (run test suite after code changes, lint before commits)
- **Background Tasks**: Keep long-running processes active without blocking progress

### Extended Thinking System
Unique thinking budget hierarchy controlled by magic words:
| Keyword | Token Budget | Use Case |
|---------|--------------|----------|
| "think" | 4,000 tokens | Routine debugging, basic refactoring |
| "think hard" / "megathink" | 10,000 tokens | Architectural decisions, complex debugging |
| "think harder" / "ultrathink" | 31,999 tokens | System design, performance optimization |

**Note**: These keywords only work in the Claude Code terminal interface, not web chat or API.

### Sandboxing Architecture
- Isolates code execution with filesystem and network controls
- Automatically allows safe operations, blocks malicious ones
- Asks permission only when needed
- **Result**: 84% reduction in permission prompts internally at Anthropic
- Protection against prompt injection attacks

### Checkpoint System
- Automatically saves code state before each change
- Instant rewind to previous versions (Esc x2 or `/rewind` command)
- Enables more ambitious and wide-scale tasks with safety net

### MCP Integration
- Functions as both MCP server and client
- Can connect to any number of MCP servers to access their tools

### IDE Extensions
- Native extensions for VS Code, Cursor, Windsurf, and JetBrains
- See Claude's changes as visual diffs

## Tool System

Claude Code provides core tools for file operations, search, bash execution, and more. The Claude Agent SDK (formerly Claude Code SDK) provides:
- Same core tools as CLI
- Context management systems
- Permission frameworks
- Building blocks for custom agentic experiences

## Model Support

- **Default**: Claude Sonnet 4.5
- **Available**: Claude 4 Opus, Claude 4 Sonnet
- **Modes**: Fast response mode and Extended Thinking deep thinking mode

## Best Practices from Anthropic

1. Use "think" keywords to trigger extended thinking for complex problems
2. Give high-level instructions rather than step-by-step prescriptive guidance
3. Let the model's creativity approach problems naturally
4. Leverage checkpoints for experimental changes

## Unique Features for Grok CLI

| Feature | Implementation Priority | Complexity |
|---------|------------------------|------------|
| Extended Thinking Keywords | High | Medium |
| Checkpoint/Rewind System | High | High |
| Subagent Delegation | Medium | High |
| Sandboxing with Auto-Allow | High | High |
| Hook System | Already Implemented | - |
| Background Tasks | Already Implemented | - |

## Sources

- [Claude Code Overview](https://www.anthropic.com/claude-code)
- [Claude Code Sandboxing](https://www.anthropic.com/engineering/claude-code-sandboxing)
- [Claude Code Best Practices](https://www.anthropic.com/engineering/claude-code-best-practices)
- [Extended Thinking Modes](https://claudelog.com/faqs/what-is-ultrathink/)
