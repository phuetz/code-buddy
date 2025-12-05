# Cursor CLI - Agent Mode

## Overview

Cursor expanded its Agent capabilities from the editor to CLI, web, mobile, and Slack in 2025. The CLI allows using the full power of Cursor Agent alongside any IDE (Neovim, JetBrains, etc.) and works with any model as part of a Cursor subscription.

## Key Features

### Agent Mode

Agent mode (Cmd/Ctrl+I) is designed for complex, multi-file tasks:

- Describe high-level goals
- AI plans and executes changes across entire project
- Autonomous terminal command execution
- Create/modify files independently
- Iterate to fix errors automatically

### Permission System

Security through explicit JSON configuration (`cli-config.json`):

```json
{
  "permissions": {
    "shell_commands": {
      "allow": ["npm", "git", "python"],
      "deny": ["rm -rf", "sudo"]
    },
    "file_access": {
      "allow": ["./src/**", "./tests/**"],
      "deny": ["./secrets/**"]
    }
  }
}
```

**Permission Philosophy**:
- Incremental permission grants (add only when agent reports inability)
- Command whitelists for trusted operations
- "Yolo mode" for full autonomy (controversial - leads to "button mashing")

### Context Management

#### Partial File Reading
- Default: First 250 lines of a file
- Extension: Another 250 lines if needed
- Search results: Maximum 100 lines
- **Trade-off**: Conserves context length, reduces costs

#### Custom Retrieval Models
- Analyzes codebase for relevant files, functions, patterns
- No manual input required for context selection

#### Project Rules (.cursor/rules)
Stored as Markdown files, version-controlled:

| Apply Mode | Description |
|------------|-------------|
| always | Always active |
| auto-attach | Based on file patterns |
| agent requested | Agent can invoke |
| manually | User-triggered only |

**User Rules**: Global rules in settings, apply to all projects.

### MCP Integration

Model Context Protocol allows:
- Connection to external services, APIs, databases
- Context-aware automation engine
- Multi-agent orchestration platform
- Data fetching, task execution, system syncing

### Privacy Mode

- Zero-retention routing
- Background agents may be limited
- Memory-like features unavailable when enforced organization-wide

## Context Window Strategies

1. **Aggressive Truncation**: 250-line default limits file reads
2. **Smart Search**: Custom retrieval models find relevant context
3. **Rule-Based Context**: Project rules add consistent instructions
4. **MCP Expansion**: External context via protocol

## Error Handling

- Agents often fail due to:
  - Missing permissions
  - Lack of real-world context
  - Incorrect understanding of action sequences
- Solution: Add permissions incrementally as failures occur

## Unique Features for Grok CLI

| Feature | Implementation Priority | Complexity |
|---------|------------------------|------------|
| Project Rules System (.grok/rules) | High | Medium |
| Partial File Reading Strategy | High | Low |
| JSON Permission Configuration | Medium | Medium |
| Custom Retrieval Models | High | High |
| MCP Multi-Agent Orchestration | Medium | High |

## Sources

- [Cursor Agent CLI](https://cursor.com/blog/cli)
- [Cursor Features](https://cursor.com/features)
- [Context Management in Cursor](https://stevekinney.com/courses/ai-development/cursor-context)
- [Cursor AI Review 2025](https://skywork.ai/blog/cursor-ai-review-2025-agent-refactors-privacy/)
