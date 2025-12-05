# Cursor CLI

## Overview

Cursor is primarily an AI-powered IDE, but in August 2025 they released a CLI version (Cursor Agent CLI) that brings their agent capabilities to the terminal. This allows developers to use Cursor's AI features in headless environments, remote servers, and CI/CD pipelines.

## Architecture

### Core Design
- Extension of Cursor IDE's Agent capabilities
- Same models and security posture as IDE version
- Designed for terminal-centric workflows

### Deployment Environments
- Remote Linux servers
- Docker containers
- CI/CD pipelines
- Local terminal alongside any IDE

## Key Features

### Installation
```bash
curl https://cursor.com/install -fsSL | bash
cursor-agent chat "find one bug and fix it"
```

### Interactive Mode
- Prompts for approval (Y/N) before shell commands
- No action without explicit consent
- Matches IDE's ask-to-apply security model

### Model Support
- OpenAI (GPT-5)
- Anthropic (Claude series)
- Google (Gemini)
- Fast model switching via slash commands

### Sandboxed Terminals (GA on macOS)
- Agent commands run in secure sandbox by default
- Read/write access limited to workspace
- No internet access for non-allowlisted commands
- Safety-first approach to autonomous operation

## Tool Calling Patterns

### Capabilities
- Code search (instant grep)
- File generation and editing
- Terminal command execution
- Codebase navigation

### Configuration
```json
// cli-config.json
{
  "permissions": {
    "read": [...],
    "execute": [...],
    "modify": [...]
  }
}
```

### Instant Grep
- All agent grep commands execute instantly
- Supports regex and word boundary matching
- Also used in sidebar search

## Context Management

### IDE Integration
- Leverages existing Cursor setup
- Same context awareness as IDE agent
- Tab autocomplete context carries over

### Parallel Agents
- Multiple agents can run simultaneously
- Terminal agents alongside IDE agents
- Useful for complex, multi-part tasks

## CI/CD Integration

### GitHub Actions
```yaml
# Example workflow integration
- uses: cursor-agent
  with:
    prompt: "Review and fix any linting issues"
```

### Automation Workflows
- Code review automation
- Documentation updates
- Continuous integration fixes

## IDE Compatibility

### For Non-Cursor Users
- Neovim users can use CLI alongside their editor
- JetBrains IDE users get Cursor Agent capabilities
- Universal access to Cursor's agent features

### Command K in Terminal
- AI-assisted commands in integrated terminal
- Quick command generation
- Natural language to shell

## Strengths for Grok CLI Reference

1. **Sandboxed execution**: Security-first autonomous operation
2. **JSON permission config**: Fine-grained access control
3. **Parallel agent support**: Multiple agents simultaneously
4. **Instant grep**: Optimized search performance
5. **CI/CD integration**: GitHub Actions patterns

## Actionable Insights

### Implement Sandboxed Execution
```
1. Limit filesystem access to workspace
2. Network access restrictions
3. Allowlist for trusted commands
4. Transparent permission model
```

### Add Permission Configuration
```json
{
  "allowed_paths": ["./src", "./tests"],
  "allowed_commands": ["npm", "git"],
  "network_access": false
}
```

### CI/CD Integration Pattern
```
1. GitHub Actions integration
2. Pre-commit hook support
3. Headless mode for automation
4. Exit codes for pipeline status
```

## Sources
- [Cursor Features](https://cursor.com/features)
- [Cursor Agent CLI Blog](https://cursor.com/blog/cli)
- [Cursor Changelog](https://cursor.com/changelog)
- [Cursor CLI First Impressions](https://lgallardo.com/2025/08/08/cursor-cli-first-impressions/)
- [Claude Code vs Cursor Comparison](https://www.qodo.ai/blog/claude-code-vs-cursor/)
