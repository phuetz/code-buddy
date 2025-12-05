# Aider - AI Pair Programming

## Overview

Aider is an open-source terminal-based coding tool that connects to multiple LLMs (GPT-4o, Claude 3.5 Sonnet, DeepSeek V3, local models) to assist with programming tasks. It integrates deeply with Git repositories and provides intelligent code context through its repository map system.

## Key Features

### Repository Map System

The repo map is one of Aider's most innovative features:

- **Concise Codebase Summary**: Contains the most important classes and functions with their types and call signatures
- **Graph Ranking Algorithm**: For large repos, uses graph analysis where files are nodes and edges represent dependencies
- **Token Budget Optimization**: Selects only the most important parts that fit the active token budget
- **Contextual Understanding**: Helps the LLM understand how edited code relates to other parts of the codebase

**Implementation**: Uses Tree-sitter for AST parsing to extract symbols and their definitions.

### Edit Formats

Aider supports multiple edit formats optimized for different models:

| Format | Description | Best For | Token Usage |
|--------|-------------|----------|-------------|
| **whole** | Returns full updated file | Simple models | High |
| **diff** | Search/replace blocks | Most models | Medium |
| **udiff** | Unified diff format | GPT-4 Turbo | Low |
| **editor-diff** | Streamlined diff for architect mode | Architect mode | Low |
| **editor-whole** | Streamlined whole for architect mode | Architect mode | Medium |

### Architect Mode

Separates coding into two inference steps:

1. **Architect Model**: Solves the coding problem, describes solution in natural language
2. **Editor Model**: Converts solution into well-formed code edits

**Benefits**:
- 100% well-formed edit rate (vs 92% without) for models like Qwen2.5-Coder-32B
- Better code formatting correctness
- Allows architect to focus on problem-solving without edit format constraints

### Chat Modes

| Mode | Purpose |
|------|---------|
| code | Direct code editing |
| architect | Two-step reasoning + editing |
| ask | Questions about codebase |
| help | Aider usage help |

### Git Integration

- **Automatic Commits**: Every AI change gets committed with descriptive messages
- **Easy Undo**: `/undo` command instantly reverts last commit
- **Safety Net**: Standard git workflows for managing change sequences
- **Cherry-picking**: Use standard git commands for selective changes

### Voice-to-Code

Speak with Aider about your code - enables hands-free pair programming.

### Watch Mode

- Monitors files for AI comments
- Responds to comments in your favorite IDE/text editor
- Enables async collaboration workflow

## Performance Optimizations

### Prompt Caching

Aider supports prompt caching for:
- Cost savings (up to 90% reduction)
- Faster response times (up to 80% latency reduction)
- Efficient handling of large static contexts

### Token Efficiency

- Diff-based edit formats minimize token usage
- Repo map only sends relevant portions
- Graph ranking prioritizes important files

## Unique Features for Grok CLI

| Feature | Implementation Priority | Complexity |
|---------|------------------------|------------|
| Repository Map with Graph Ranking | High | High |
| Architect/Editor Mode | High | Medium |
| Multiple Edit Formats | Medium | Medium |
| Watch Mode for IDE Comments | Low | Medium |
| Voice-to-Code | Already Implemented | - |
| Git Auto-Commit | Medium | Low |

## Configuration

- Model selection per mode
- Edit format override with `--edit-format`
- Editor model customization with `--editor-edit-format`

## Sources

- [Aider Documentation](https://aider.chat/docs/)
- [Repository Map](https://aider.chat/docs/repomap.html)
- [Edit Formats](https://aider.chat/docs/more/edit-formats.html)
- [Architect Mode](https://aider.chat/2024/09/26/architect.html)
- [Chat Modes](https://aider.chat/docs/usage/modes.html)
