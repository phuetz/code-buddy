# Aider (Paul Gauthier)

## Overview

Aider is an open-source AI pair programming tool that runs in the terminal. It's one of the earliest and most influential CLI-based coding assistants, known for its innovative approaches to code editing and context management.

## Architecture

### Core Design
- **Bring-your-own LLM**: Supports OpenAI, Anthropic, DeepSeek, local models via Ollama
- **Git-centric**: Every edit arrives as a standard git patch
- **CLI-first**: Primary interface with optional web UI and VS Code extensions

### Key Components
- **Edit Format Handlers**: Interpret LLM output and apply changes
- **Diff Utilities**: Functions like `diff_partial_update` for change application
- **Repository Map Generator**: Tree-sitter based code parsing
- **Chat Modes**: Different interaction paradigms (code, architect, ask)

## Code Editing Approach

### Unified Diff Format
Aider's signature innovation - using unified diffs dramatically improves edit quality:

**Design Principles:**
1. **FAMILIAR**: Use formats GPT already knows (unified diff)
2. **SIMPLE**: Avoid brittle specifiers like line numbers
3. **HIGH LEVEL**: Edits as new versions of code blocks, not surgical changes
4. **FLEXIBLE**: Maximally flexible interpretation of edit instructions

**Implementation Details:**
- Line numbers omitted (LLMs are terrible with them)
- Each hunk treated as search/replace operation
- Normalization and sub-hunk splitting for error recovery
- 3X reduction in "lazy coding" behavior

### Benchmark Results
- Baseline (SEARCH/REPLACE): 20% success rate
- Unified diff format: 61% success rate
- Lazy comments reduced from 12 to 4 tasks

### Multiple Edit Formats
- Different formats optimized for different LLMs
- Format selection based on task/model characteristics
- Leaderboards track which LLMs work best with which format

## Context Management

### Repository Map (Key Innovation)

**What It Is:**
A concise map of the entire git repository showing the most important classes, functions, types, and call signatures.

**How It's Built:**
1. **Tree-sitter parsing**: Extracts symbol definitions from source files
2. **Graph construction**: Files as nodes, dependencies as edges
3. **PageRank algorithm**: Ranks symbols by importance (reference frequency)
4. **Token optimization**: Binary search to fit within budget

**Key Features:**
- Sent with each change request
- Shows critical lines of code for each definition
- Only includes most-referenced identifiers
- Dynamic sizing based on chat state

### Token Budget Management
- Default: 1k tokens for repo map (`--map-tokens`)
- Adjusts dynamically based on conversation state
- Prompt caching reduces costs (7-10 cents to 2-4 cents per command)

### Manual Context Control
- `/add <files>`: Add files to context
- `/drop <files>`: Remove files from context
- `/clear`: Clear all context
- Read-only files for static information (best practices, lessons learned)

## Chat Modes

### Code Mode (Default)
- Write, edit, and refactor files directly
- Actual code changes applied to codebase

### Architect Mode (`/mode architect`)
- Planning and design discussions
- Architecture exploration before implementation
- No direct file changes

### Ask Mode (`/mode ask`)
- Coding consultant mode
- Questions answered without changes
- Understanding existing code

## Git Integration

### Automatic Commits
- Descriptive commit messages generated automatically
- Stages uncommitted changes before making modifications
- Clean, reviewable history of AI-assisted edits

### Workflow
1. Aider shows diffs before committing
2. User reviews changes
3. Familiar git tools for diff, manage, undo

## Strengths for Grok CLI Reference

1. **Unified diff format**: Proven to dramatically improve edit quality
2. **Repository map with PageRank**: Intelligent context selection without embeddings
3. **Tree-sitter integration**: Language-aware code parsing
4. **Multiple chat modes**: Different paradigms for different tasks
5. **Prompt caching**: Significant cost reduction
6. **Git-native**: Seamless version control integration

## Actionable Insights

### Implement Repository Map
```
1. Use tree-sitter for symbol extraction
2. Build file dependency graph
3. Apply PageRank for importance ranking
4. Token-budget aware truncation
```

### Adopt Unified Diff Editing
```
1. Omit line numbers (LLMs fail at them)
2. Treat hunks as search/replace
3. Implement flexible matching with normalization
4. Support sub-hunk splitting for recovery
```

### Add Chat Modes
```
1. Architect mode for planning
2. Ask mode for understanding
3. Code mode for implementation
```

## Sources
- [Aider Official](https://aider.chat/)
- [GitHub Repository](https://github.com/Aider-AI/aider)
- [Unified Diffs Documentation](https://aider.chat/docs/unified-diffs.html)
- [Repository Map](https://aider.chat/docs/repomap.html)
- [Building Repo Map with Tree-sitter](https://aider.chat/2023/10/22/repomap.html)
- [Edit Formats](https://aider.chat/docs/more/edit-formats.html)
