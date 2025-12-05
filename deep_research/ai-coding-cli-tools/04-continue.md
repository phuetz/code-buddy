# Continue - Open Source AI Code Agent

## Overview

Continue is the leading open-source AI code agent, available as a VS Code extension and CLI tool. It provides TUI and headless modes, allowing interactive terminal development and background agent automation.

## Architecture

### Component Structure

```
core <-> extension <-> gui
```

| Component | Purpose |
|-----------|---------|
| **core** | Core logic, protocol definitions |
| **gui** | React-based UI for side panel webview |
| **extensions/vscode** | VS Code extension (Node.js) |
| **packages** | Shared code as public NPM packages |
| **docs** | Documentation |

### Technology Stack

- TypeScript throughout
- VS Code Extension API
- React with Redux Toolkit for state management
- Message passing architecture with known protocol

### Protocol Interface

Defined in `core/protocol` folder - enables clean separation between components.

## Key Features

### CLI Modes

| Mode | Use Case |
|------|----------|
| **TUI** | Interactive terminal interface for development |
| **Headless** | Background agents, CI/CD pipelines |

### Background Agents

- Launch in seconds
- Battle-tested workflows for GitHub, Sentry, Snyk, Linear
- Customizable prompts, models, and MCP tools

### Terminal Automation

- Automation for builds and refactoring
- Pre-commit hooks and scripted fixes
- Batch processing and bulk operations
- CI/CD pipeline integration

### Real-Time Autocomplete

- Context-aware code completion
- Reduces cognitive load
- Minimizes workflow interruptions

### Model Flexibility

Connect any AI model:
- OpenAI
- Anthropic
- Local models
- Any OpenAI-compatible API

## Configuration

### config.json / config.yaml

Defines:
- List of models (chat, edit, apply, embed, rerank roles)
- Context providers
- System message (rules)
- Custom slash commands
- Other settings

### Model Roles

| Role | Purpose |
|------|---------|
| chat | Conversational interactions |
| edit | Code modifications |
| apply | Applying changes |
| embed | Embeddings generation |
| rerank | Search result reranking |

### Custom Slash Commands

User-defined commands for common workflows.

## IDE Integration

- VS Code extension
- JetBrains plugin (IntelliJ, PyCharm, WebStorm)
- TUI for terminal-first workflows

## Patterns for CLI Implementation

### Message Passing Architecture

```typescript
// Core defines protocol
interface Protocol {
  // Incoming from extension/gui
  'editor/getSelection': () => Selection;
  'chat/sendMessage': (msg: Message) => Response;

  // Outgoing to extension/gui
  'ui/showDiff': (diff: Diff) => void;
  'status/update': (status: Status) => void;
}
```

### Background Agent Pattern

```typescript
// Headless mode for automation
interface BackgroundAgent {
  workflow: string;  // github, sentry, linear
  config: AgentConfig;
  triggers: Trigger[];
  actions: Action[];
}
```

## Unique Features for Grok CLI

| Feature | Implementation Priority | Complexity |
|---------|------------------------|------------|
| Headless/Background Mode | Medium | Medium |
| Battle-tested Workflow Templates | Low | Medium |
| Model Role Configuration | Medium | Low |
| Message Passing Protocol | Low | Medium |
| Embed/Rerank Model Support | High | Medium |
| Custom Slash Commands | Already Implemented | - |

## Sources

- [Continue Documentation](https://docs.continue.dev/)
- [Continue GitHub](https://github.com/continuedev/continue)
- [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=Continue.continue)
