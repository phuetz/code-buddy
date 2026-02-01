<div align="center">

<img src="https://img.shields.io/badge/🤖-Code_Buddy-blueviolet?style=for-the-badge&labelColor=1a1a2e" alt="Code Buddy"/>

# Code Buddy

### AI-Powered Development Agent for Your Terminal

<p align="center">
  <a href="https://www.npmjs.com/package/@phuetz/code-buddy"><img src="https://img.shields.io/npm/v/@phuetz/code-buddy.svg?style=flat-square&color=ff6b6b&label=version" alt="npm version"/></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-feca57.svg?style=flat-square" alt="License: MIT"/></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D18.0.0-54a0ff?style=flat-square&logo=node.js" alt="Node Version"/></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.3-5f27cd?style=flat-square&logo=typescript" alt="TypeScript"/></a>
  <a href="https://www.npmjs.com/package/@phuetz/code-buddy"><img src="https://img.shields.io/npm/dm/@phuetz/code-buddy.svg?style=flat-square&color=10ac84" alt="npm downloads"/></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Tests-passing-00d26a?style=flat-square&logo=jest" alt="Tests"/>
  <img src="https://img.shields.io/badge/Coverage-85%25-48dbfb?style=flat-square" alt="Coverage"/>
  <img src="https://img.shields.io/badge/Build-passing-00d26a?style=flat-square" alt="Build"/>
</p>

<br/>

**A powerful CLI tool that brings the best AI models (Grok, Claude, ChatGPT, Gemini) directly into your terminal with Claude Code-level intelligence, advanced code analysis, and full development capabilities.**

<br/>

[Quick Start](#-quick-start) |
[AI Providers](#-ai-providers) |
[Features](#-features) |
[Configuration](#-configuration) |
[Plugin Development](#-plugin-development) |
[API Server](#-api-server) |
[Troubleshooting](#-troubleshooting)

</div>

---

## Installation

### Prerequisites

- **Node.js** 18.0.0 or higher
- **ripgrep** (optional but recommended for faster code search)

```bash
# macOS
brew install ripgrep

# Ubuntu/Debian
sudo apt-get install ripgrep

# Windows
choco install ripgrep
```

### Install Code Buddy

```bash
# npm (recommended)
npm install -g @phuetz/code-buddy

# yarn
yarn global add @phuetz/code-buddy

# pnpm
pnpm add -g @phuetz/code-buddy

# bun
bun add -g @phuetz/code-buddy
```

---

## Quick Start

```bash
# Try without installing (npx)
npx @phuetz/code-buddy@latest

# Configure your API key (from x.ai)
export GROK_API_KEY=your_api_key

# Start interactive mode
buddy

# Or run a single command (headless mode)
buddy --prompt "analyze the project structure"
```

### Common Options

```bash
# Specify working directory
buddy -d /path/to/project

# Use a specific model
buddy --model grok-4-latest

# Resume last session
buddy --resume

# YOLO mode (full autonomy - use with caution!)
YOLO_MODE=true buddy

# Use with local LLM (Ollama)
export GROK_BASE_URL=http://localhost:11434/v1
export GROK_API_KEY=ollama
buddy --model llama3.2
```

---

## AI Providers

Code Buddy supports multiple AI providers:

| Provider | Default Model | Context | API Key Variable |
|:---------|:--------------|:--------|:-----------------|
| **Grok** (xAI) | `grok-code-fast-1` | 128K | `GROK_API_KEY` |
| **Claude** (Anthropic) | `claude-sonnet-4` | 200K | `ANTHROPIC_API_KEY` |
| **ChatGPT** (OpenAI) | `gpt-4o` | 128K | `OPENAI_API_KEY` |
| **Gemini** (Google) | `gemini-2.0-flash` | 2M | `GOOGLE_API_KEY` |

### Switching Providers

```bash
# List available providers
buddy provider list

# Set active provider
buddy provider set claude

# Use provider for a single command
buddy --provider openai "explain this code"

# List models for a provider
buddy provider models claude
```

---

## Features

### Recent Improvements (27+ enhancements)

- **Facade Architecture** - Clean separation of concerns with `AgentContextFacade`, `SessionFacade`, `ModelRoutingFacade`, `InfrastructureFacade`
- **Plugin Providers** - Plugins can now register LLM, embedding, and search providers
- **Stream Helpers** - Standardized async iterable handling with timeouts, iteration limits, and error categorization
- **Input Validators** - Result-based validation for file paths, commands, URLs, API keys, and JSON
- **HTTP Server** - Full REST API with WebSocket support, JWT auth, rate limiting, and Prometheus metrics

### Core Capabilities

| Feature | Description |
|:--------|:------------|
| **Multi-Agent System** | Specialized agents (Coder, Reviewer, Tester, Refactorer, Documenter) |
| **Tree-of-Thought + MCTS** | Advanced reasoning with exploration and evaluation |
| **APR Engine** | Automatic Program Repair with fault localization |
| **RAG for Code** | Semantic code search with embeddings |
| **TDD Mode** | Test-first development workflow |
| **Cost Tracking** | Real-time token usage and cost monitoring |
| **Lifecycle Hooks** | Pre/post hooks for edit, bash, commit, prompt |

### Security Modes

| Mode | Description |
|:-----|:------------|
| `read-only` | No modifications allowed |
| `auto` | Auto-approve safe operations, confirm others |
| `full-access` | Full autonomy (use in trusted environments) |

```bash
/mode read-only   # Switch to safe mode
/security status  # View security dashboard
```

### Slash Commands

| Command | Description |
|:--------|:------------|
| `/help` | Show help |
| `/model` | Change model |
| `/mode` | Change security mode |
| `/think` | Enable reasoning (4K tokens) |
| `/megathink` | Deep reasoning (10K tokens) |
| `/ultrathink` | Exhaustive reasoning (32K tokens) |
| `/cost` | Show cost dashboard |
| `/tdd start` | Start TDD mode |
| `/hooks list` | List lifecycle hooks |

---

## Configuration

### Environment Variables

| Variable | Description | Default |
|:---------|:------------|:--------|
| `GROK_API_KEY` | xAI API key (required) | - |
| `ANTHROPIC_API_KEY` | Anthropic API key | - |
| `OPENAI_API_KEY` | OpenAI API key | - |
| `GOOGLE_API_KEY` | Google AI API key | - |
| `GROK_BASE_URL` | Custom API endpoint | `https://api.x.ai/v1` |
| `GROK_MODEL` | Default model | `grok-code-fast-1` |
| `YOLO_MODE` | Enable full autonomy | `false` |
| `MAX_COST` | Session cost limit ($) | `10` |
| `MORPH_API_KEY` | Enable fast file editing | - |

### User Settings

Create `~/.codebuddy/user-settings.json`:

```json
{
  "apiKey": "your-api-key",
  "defaultModel": "grok-4-latest",
  "theme": "dark",
  "securityMode": "auto"
}
```

### Project Settings

Create `.codebuddy/settings.json` in your project root:

```json
{
  "systemPrompt": "You are working on a TypeScript project using React.",
  "tools": {
    "enabled": ["read_file", "write_file", "bash"],
    "disabled": ["web_search"]
  }
}
```

---

## Plugin Development

Plugins extend Code Buddy with custom tools, commands, and providers.

### Plugin Structure

```
~/.codebuddy/plugins/
  my-plugin/
    manifest.json
    index.js
```

### manifest.json

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "A custom plugin",
  "author": "Your Name",
  "permissions": {
    "filesystem": ["./data"],
    "network": ["api.example.com"]
  },
  "configSchema": {
    "type": "object",
    "properties": {
      "apiKey": { "type": "string", "description": "API key" }
    },
    "required": ["apiKey"]
  }
}
```

### Plugin Implementation

```typescript
// index.ts
import { Plugin, PluginContext } from '@phuetz/code-buddy/plugins';

const plugin: Plugin = {
  async activate(context: PluginContext) {
    // Register a tool
    context.registerTool({
      name: 'my_tool',
      description: 'Does something useful',
      parameters: {
        type: 'object',
        properties: {
          input: { type: 'string', description: 'Input text' }
        },
        required: ['input']
      },
      execute: async (args) => {
        return { success: true, output: `Processed: ${args.input}` };
      }
    });

    // Register a provider (LLM, embedding, or search)
    context.registerProvider({
      id: 'my-llm',
      name: 'My LLM Provider',
      type: 'llm',
      priority: 10,
      async initialize() { /* setup */ },
      async chat(messages) { return 'response'; }
    });

    context.logger.info('Plugin activated');
  },

  async deactivate() {
    // Cleanup
  }
};

export default plugin;
```

### Plugin Management

```bash
/plugin list              # List installed plugins
/plugin enable my-plugin  # Enable a plugin
/plugin disable my-plugin # Disable a plugin
```

---

## API Server

Code Buddy includes a REST API server with WebSocket support.

### Starting the Server

```bash
# Start with defaults (port 3000)
buddy server

# Custom port
buddy server --port 8080

# With authentication disabled (development only)
AUTH_ENABLED=false buddy server
```

### Endpoints

| Endpoint | Method | Description |
|:---------|:-------|:------------|
| `/api/health` | GET | Health check |
| `/api/metrics` | GET | Prometheus metrics |
| `/api/chat` | POST | Send chat message |
| `/api/chat/completions` | POST | OpenAI-compatible endpoint |
| `/api/tools` | GET | List available tools |
| `/api/tools/{name}/execute` | POST | Execute a tool |
| `/api/sessions` | GET/POST | List/create sessions |
| `/api/memory` | GET/POST | Memory entries |

### WebSocket

Connect to `/ws` for real-time streaming:

```javascript
const ws = new WebSocket('ws://localhost:3000/ws');

// Authenticate
ws.send(JSON.stringify({
  type: 'authenticate',
  payload: { token: 'your-jwt-token' }
}));

// Send chat message
ws.send(JSON.stringify({
  type: 'chat_stream',
  payload: { messages: [{ role: 'user', content: 'Hello' }] }
}));
```

See [docs/API.md](docs/API.md) for full API documentation.

---

## Troubleshooting

### Common Issues

**API key not working**
```bash
# Verify your key is set
echo $GROK_API_KEY

# Test connection
buddy --prompt "hello"
```

**High latency**
- Try a faster model: `buddy --model grok-code-fast-1`
- Use local LLM with Ollama for offline work

**Out of memory**
- Reduce context window: adjust `contextWindow` in settings
- Clear conversation: `/clear`

**Tools not executing**
- Check security mode: `/mode auto`
- Verify file permissions in working directory

**Plugin not loading**
- Check manifest.json format
- Verify plugin path: `~/.codebuddy/plugins/plugin-name/`
- Check logs: `buddy --debug`

### Debug Mode

```bash
# Enable verbose logging
DEBUG=codebuddy:* buddy

# Check version
buddy --version
```

### Getting Help

- [GitHub Issues](https://github.com/phuetz/code-buddy/issues)
- [Discussions](https://github.com/phuetz/code-buddy/discussions)

---

## Documentation

- [Architecture](ARCHITECTURE.md) - System design
- [AI Providers](docs/ai-providers.md) - Provider configuration
- [API Reference](docs/API.md) - HTTP/WebSocket API
- [CLAUDE.md](CLAUDE.md) - Guide for AI assistants
- [Changelog](CHANGELOG.md) - Version history

---

## Contributing

```bash
# Clone and install
git clone https://github.com/phuetz/code-buddy.git
cd code-buddy
npm install

# Development
npm run dev

# Run tests
npm test

# Validate before committing
npm run validate
```

---

## License

MIT License - see [LICENSE](LICENSE) for details.

---

<div align="center">

**[Report Bug](https://github.com/phuetz/code-buddy/issues)** |
**[Request Feature](https://github.com/phuetz/code-buddy/discussions)** |
**[Star on GitHub](https://github.com/phuetz/code-buddy)**

<sub>Multi-AI: Grok | Claude | ChatGPT | Gemini | Inspired by Claude Code</sub>

</div>
