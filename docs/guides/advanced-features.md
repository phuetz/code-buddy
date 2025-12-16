# Advanced Features

## Multi-Agent Mode

Code Buddy supports spawning multiple specialized agents for complex tasks.

```bash
# Enable multi-agent orchestration
grok --multi-agent

# Available specialized agents:
# - CodeGuardian: Security-focused code review
# - DataAnalysis: Data processing and visualization
# - TestGenerator: Automated test creation
# - DocWriter: Documentation generation
```

## Parallel Execution

For large tasks, Code Buddy can work in parallel using git worktrees:

```bash
# Enable parallel mode (up to 16 concurrent agents)
grok --parallel --max-workers 4

# Use remote machines via SSH
grok --parallel --remote user@server1,user@server2
```

## Tree of Thought Reasoning

Enable advanced reasoning for complex problems:

```bash
# Use thinking keywords for extended reasoning
grok --thinking-mode auto

# Trigger thinking with specific keywords:
# - "think step by step"
# - "reason through this"
# - "analyze deeply"
```

## Custom Personas

```bash
# List available personas
/persona list

# Switch persona
/persona set senior-developer
/persona set security-expert
/persona set minimalist

# Create custom persona
/persona create my-persona
```

## Hooks System

Create `.codebuddy/hooks.json` to run custom scripts:

```json
{
  "hooks": [
    {
      "type": "pre-edit",
      "command": "npm run lint",
      "continueOnError": false
    },
    {
      "type": "post-commit",
      "command": "npm test"
    }
  ]
}
```

Available hook types:
- `pre-commit`, `post-commit`
- `pre-edit`, `post-edit`
- `pre-bash`, `post-bash`
- `on-file-change`
- `on-error`

## Skills

Skills are reusable AI capabilities:

```bash
# List installed skills
/skills list

# Install a skill
/skills install code-reviewer

# Use a skill
/skills run code-reviewer --file src/main.ts
```

## Context Management

### Codebase RAG

Code Buddy uses RAG to understand your codebase:

```bash
# Index the project
/index

# Search semantically
/search "authentication logic"

# Get repository overview
/map
```

### Smart Context

The AI automatically includes relevant context:
- Currently open files
- Recent changes
- Related imports
- Test files
- Documentation

## Cost Management

```bash
# View session cost
/cost

# Set cost limit
grok --max-cost 10

# View cost breakdown
/cost --detailed
```

## Offline Mode

```bash
# Enable offline mode with local LLM fallback
grok --offline

# Configure offline LLM
export GROK_OFFLINE_MODEL=llama3.2
export GROK_OFFLINE_URL=http://localhost:11434/v1
```

## Collaboration

```bash
# Start collaboration server
grok serve --port 8080

# Join a session
grok join ws://localhost:8080 --session abc123

# Share session
/share --invite
```

## Debugging

```bash
# Enable debug logging
DEBUG=codebuddy grok

# Verbose output
grok --verbose

# Save interaction log
grok --log-file session.log
```

## Configuration Files

### User Settings (~/.codebuddy/user-settings.json)

```json
{
  "apiKey": "xai-...",
  "defaultModel": "grok-3",
  "theme": "dark",
  "securityMode": "auto-edit",
  "maxCost": 10
}
```

### Project Settings (.codebuddy/settings.json)

```json
{
  "ignorePaths": ["node_modules", "dist"],
  "tools": {
    "enabled": ["bash", "search", "edit"],
    "disabled": ["web-browser"]
  },
  "personas": {
    "default": "senior-developer"
  }
}
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GROK_API_KEY` | API key for Grok |
| `GROK_BASE_URL` | Custom API endpoint |
| `GROK_MODEL` | Default model |
| `YOLO_MODE` | Enable full autonomy |
| `MAX_COST` | Session cost limit |
| `DEBUG` | Enable debug logging |
| `LOG_LEVEL` | Logging verbosity |
| `NO_COLOR` | Disable colored output |
