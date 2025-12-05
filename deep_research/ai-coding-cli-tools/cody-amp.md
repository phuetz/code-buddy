# Cody CLI and Amp (Sourcegraph)

## Overview

Sourcegraph's Cody CLI brought enterprise code intelligence to the terminal, leveraging Sourcegraph's code graph and search capabilities. As of July 2025, Cody has been succeeded by **Amp**, Sourcegraph's frontier coding agent designed for autonomous reasoning and complex task execution.

## Cody CLI (Legacy)

### Core Features
- Deep codebase awareness via Sourcegraph indexes
- Context-aware code suggestions
- Whole-codebase intelligence
- Enterprise-grade security

### Usage Example
```bash
cody chat --context-file src/foo.js -m "Optimize this function"
```

### Agentic Chat
When enabled, Cody could access:
- Code search
- Codebase files
- Terminal
- Web browser searches
- OpenCtx-compatible tools

### Smart Apply
- Terminal command execution
- One-click suggestion application

## Amp (Current)

### Overview
Amp is Sourcegraph's frontier coding agent, available as CLI and VS Code extension. It's designed to maximize frontier model capabilities.

### Installation
```bash
pnpm add -g @sourcegraph/amp@latest
# or
npm install -g @sourcegraph/amp@latest
```

### Key Features

#### Multi-Model Architecture
- Claude Opus 4.5
- GPT-5.1
- Fast models for specific tasks
- Automatic model selection based on task

#### Operating Modes

**Smart Mode (Default)**
- State-of-the-art models
- No constraints
- Maximum capability and autonomy
- Uses paid credits

**Rush Mode**
- Faster, cheaper
- Less capable
- Best for small, well-defined tasks

#### Context Management
- Fixed 200K token context window
- "Max out" philosophy - give AI as much info as possible
- Deep codebase awareness

#### Subagents
- Spawn independent execution contexts
- Own context window per subagent
- Full tool access (files, terminal)
- Use cases:
  - Multi-step tasks broken into parts
  - Operations with extensive output
  - Parallel work across code areas
  - Keeping main thread context clean

#### The Librarian
- Cross-repository research
- Read framework/library code
- In-depth explanations
- Longer, more detailed answers

#### Thread Sharing
- Save and share interactions
- Sync to ampcode.com
- Continue conversations across devices

### Deployment Flexibility
- Terminal CLI
- VS Code extension
- CI/CD pipelines
- Docker containers
- Any environment with terminal access

## Tool Calling Patterns

### Amp's Approach
- Task tool for spawning subagents
- File editing tools
- Terminal command execution
- Code search
- Web research

### Token Philosophy
- Unconstrained token usage
- Always use best model for task
- Quality over cost optimization

## Strengths for Grok CLI Reference

1. **Multi-model strategy**: Different models for different tasks
2. **Operating modes**: Smart vs Rush for cost/speed tradeoffs
3. **Subagent architecture**: Parallel execution with isolated contexts
4. **Librarian feature**: Cross-repo knowledge retrieval
5. **Thread persistence**: Save and share conversation state
6. **200K context window usage**: Maximize available context

## Actionable Insights

### Implement Operating Modes
```typescript
enum OperatingMode {
  SMART = 'smart',  // Best quality, higher cost
  RUSH = 'rush'     // Fast, cheap, simple tasks
}

interface ModeConfig {
  model: string;
  maxTokens: number;
  costLimit?: number;
}
```

### Add Subagent Pattern
```typescript
interface Subagent {
  id: string;
  contextWindow: number;
  tools: Tool[];
  parentId?: string;
  task: string;
}

// Spawn for independent work
const subagent = await spawnSubagent({
  task: "Refactor authentication module",
  tools: ['file_edit', 'terminal'],
  isolation: true
});
```

### Implement Thread Persistence
```
1. Save conversation state
2. Unique thread IDs
3. Resume capability
4. Optional cloud sync
```

### Multi-Model Selection
```typescript
function selectModel(task: TaskType): Model {
  if (task.complexity === 'high') {
    return 'claude-opus-4.5';
  } else if (task.requiresSpeed) {
    return 'fast-model';
  }
  return 'default-model';
}
```

## Sources
- [Amp by Sourcegraph](https://sourcegraph.com/amp)
- [Amp NPM Package](https://www.npmjs.com/package/@sourcegraph/amp)
- [Amp Owner's Manual](https://ampcode.com/manual)
- [Ampcode](https://ampcode.com/)
- [Cody Documentation](https://sourcegraph.com/docs/cody)
- [Cody CLI Docs](https://sourcegraph.com/docs/cody/clients/install-cli)
