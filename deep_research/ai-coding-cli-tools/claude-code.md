# Claude Code (Anthropic)

## Overview

Claude Code is Anthropic's official agentic coding tool that lives in the terminal. It understands codebases and helps developers code faster by executing routine tasks, explaining complex code, and handling git workflows through natural language commands.

## Architecture

### Technology Stack
- **TypeScript** - Primary language
- **React** - UI framework
- **Ink** - React renderer for CLI (terminal UI)
- **Yoga** - Flexbox layout system (open-sourced by Meta)
- **Bun** - JavaScript runtime

The stack was chosen to be "on distribution" - technologies Claude models are already proficient with, reducing the likelihood of bugs in the tooling itself.

### Design Philosophy
- **Low-level and unopinionated**: Provides close to raw model access without forcing specific workflows
- **Flexible and customizable**: Users can adapt it to their needs
- **Scriptable**: Can be integrated into automated workflows
- **Safe**: Includes confirmation mechanisms for destructive operations

## Terminal UI Implementation

### Ink Framework
Claude Code uses Ink, which translates React code to ANSI terminal sequences. Key characteristics:
- Flexbox layouts via Yoga (CSS-like properties available)
- Standard React features (hooks, state, effects)
- Components: `<Box>`, `<Text>`, `<Static>`, `<Transform>`
- Focus management via `useFocus` hook

### Cross-Terminal Challenges
- ANSI escape codes vary between terminals
- Similar to browser compatibility issues from early web
- Must account for differences between Terminal.app, iTerm, Windows Terminal, etc.

## Key Features

### Agentic Loop
- Autonomous operation with tool calling
- Maximum ~30 rounds per task
- Sub-agents for delegated specialized tasks

### Checkpoints System
- Automatically saves code state before each change
- Instant rewind with Esc+Esc or `/rewind` command
- Enables more ambitious, wide-scale tasks

### Sub-Agents
- Specialized AI assistants with own instructions and context windows
- Independent tool permissions
- Parallel development workflows (e.g., backend API + frontend simultaneously)

### Hooks System
- Event-driven triggers at specific points
- Examples: run tests after code changes, lint before commits
- Configurable via `.grok/hooks.json`

### Background Tasks
- Long-running processes (dev servers) without blocking main workflow
- Async operation management

### MCP (Model Context Protocol) Integration
- Anthropic's open standard for connecting AI to external tools
- Universal connector for Jira, GitHub, databases, etc.
- Enables extensibility beyond built-in tools

## Tool Calling Patterns

### Built-in Tools
- File operations (read, write, edit)
- Bash command execution
- Git operations
- Search (glob, grep)
- Web fetch

### Safety Mechanisms
- Confirmation prompts for destructive operations
- Sandboxed execution options
- Permission-based access control

## Context Management

### Approach
- Direct codebase access via file tools
- No explicit embedding/RAG system documented
- Relies on model's understanding and tool results
- Dynamic context through sub-agents

## Strengths for Grok CLI Reference

1. **React/Ink UI pattern** - Proven approach for rich terminal interfaces
2. **Checkpoint system** - Safety net for autonomous operation
3. **Sub-agent architecture** - Parallel task execution
4. **Hooks system** - Event-driven automation
5. **MCP standard** - Extensibility protocol

## Sources
- [Claude Code Official](https://www.anthropic.com/claude-code)
- [Claude Code Docs](https://docs.anthropic.com/en/docs/claude-code/overview)
- [GitHub Repository](https://github.com/anthropics/claude-code)
- [Best Practices](https://www.anthropic.com/engineering/claude-code-best-practices)
- [How Claude Code is Built](https://newsletter.pragmaticengineer.com/p/how-claude-code-is-built)
