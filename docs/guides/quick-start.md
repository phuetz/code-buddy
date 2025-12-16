# Quick Start Guide

## Installation

```bash
# Install globally
npm install -g @phuetz/code-buddy

# Or use directly with npx
npx @phuetz/code-buddy@latest
```

## Configuration

### API Key Setup

```bash
# Set your Grok API key (get one at x.ai)
export GROK_API_KEY=xai-your-api-key

# Or save it persistently
grok config --api-key xai-your-api-key
```

### Alternative Providers

```bash
# Use Claude
export ANTHROPIC_API_KEY=sk-ant-...
grok --provider claude

# Use OpenAI
export OPENAI_API_KEY=sk-...
grok --provider openai

# Use local Ollama
export GROK_BASE_URL=http://localhost:11434/v1
export GROK_API_KEY=ollama
grok --model llama3.2
```

## Basic Usage

### Interactive Mode

```bash
# Start interactive chat
grok

# Start in a specific directory
grok -d /path/to/project

# Resume last session
grok --resume
```

### Headless Mode

```bash
# Single prompt execution
grok --prompt "explain what this project does"

# With specific model
grok --prompt "fix the bug in main.ts" --model grok-3

# Output as JSON (for scripts)
grok --prompt "list all TODO comments" --json
```

## Slash Commands

Inside the chat, use these commands:

| Command | Description |
|---------|-------------|
| `/help` | Show all commands |
| `/clear` | Clear conversation |
| `/model` | Change AI model |
| `/mode` | Change security mode |
| `/checkpoint` | Create restore point |
| `/undo` | Restore from checkpoint |
| `/export` | Export conversation |
| `/theme` | Change UI theme |

## Security Modes

```bash
# Suggest mode (confirm all changes)
grok --mode suggest

# Auto-edit mode (auto-approve safe operations)
grok --mode auto-edit

# Full-auto mode (all operations auto-approved)
grok --mode full-auto

# YOLO mode (maximum autonomy - use with caution!)
YOLO_MODE=true grok
```

## MCP Servers

```bash
# Add a predefined MCP server
/mcp add filesystem

# Add a custom MCP server
/mcp add myserver --command "node" --args "server.js"

# List configured servers
/mcp list

# Test connection
/mcp test filesystem
```

## Tips

1. **Context**: Use `@file:path/to/file.ts` to include files in context
2. **History**: Arrow keys navigate command history
3. **Multiline**: Use Shift+Enter for multiline input
4. **Checkpoints**: Always checkpoint before risky operations
5. **Cost**: Use `/cost` to see current session cost

## Next Steps

- Read the [full documentation](../API.md)
- Explore [advanced features](./advanced-features.md)
- Join the community on GitHub
