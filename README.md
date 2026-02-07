<div align="center">

<img src="https://img.shields.io/badge/🤖-Code_Buddy-blueviolet?style=for-the-badge&labelColor=1a1a2e" alt="Code Buddy"/>

# Code Buddy

### Multi-AI Personal Assistant with OpenClaw-Inspired Architecture

<p align="center">
  <a href="https://www.npmjs.com/package/@phuetz/code-buddy"><img src="https://img.shields.io/npm/v/@phuetz/code-buddy.svg?style=flat-square&color=ff6b6b&label=version" alt="npm version"/></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-feca57.svg?style=flat-square" alt="License: MIT"/></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D18.0.0-54a0ff?style=flat-square&logo=node.js" alt="Node Version"/></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.3-5f27cd?style=flat-square&logo=typescript" alt="TypeScript"/></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Tests-340%2B-00d26a?style=flat-square&logo=jest" alt="Tests"/>
  <img src="https://img.shields.io/badge/Coverage-85%25-48dbfb?style=flat-square" alt="Coverage"/>
  <img src="https://img.shields.io/badge/Build-passing-00d26a?style=flat-square" alt="Build"/>
</p>

<br/>

**A powerful multi-AI terminal agent inspired by [OpenClaw](https://github.com/openclaw/openclaw) architecture. Supports Grok, Claude, ChatGPT, Gemini, LM Studio, and Ollama with advanced memory, multi-channel messaging, and intelligent context management.**

<br/>

[Quick Start](#-quick-start) |
[Architecture](#-architecture) |
[Memory System](#-memory-system) |
[Channels](#-multi-channel-support) |
[Security](#-security) |
[API](#-api-server)

</div>

---

## What's New

### OpenClaw-Inspired Features

Code Buddy incorporates advanced patterns from the [OpenClaw](https://github.com/openclaw/openclaw) project:

| Module | Status | Description |
|:-------|:------:|:------------|
| **Tool Policy System** | ✅ 100% | Fine-grained tool permissions with allowlist/denylist |
| **Bash Allowlist** | ✅ 100% | Secure command execution with pattern matching |
| **Context Window Guard** | ✅ 100% | Automatic context management with 34 test cases |
| **Smart Compaction** | ✅ 100% | Multi-stage conversation compression |
| **Context Pruning** | ✅ 100% | TTL-based message expiration |
| **Hybrid Search** | ✅ 100% | Combined keyword + semantic search |
| **Lifecycle Hooks** | ✅ 100% | Pre/post hooks with 52 test cases |
| **Connection Profiles** | ✅ 100% | Multi-provider switching with 57 tests |
| **Desktop Automation** | ✅ 100% | Screen capture, OCR, UI control |
| **Gemini Vision** | ✅ 100% | Native image support via `inlineData` (base64 data URLs) |
| **Auto-Capture Memory** | ✅ 100% | Pattern-based memory extraction |
| **Memory Lifecycle** | ✅ 100% | Auto-recall and auto-capture hooks |

### Phase 3 — Streaming & Security

| Module | Status | Description |
|:-------|:------:|:------------|
| **Middleware Pipeline** | ✅ 100% | Composable before/after turn hooks (cost limit, context warning, turn limit) |
| **Reasoning Events** | ✅ 100% | Streaming chain-of-thought display with collapsible UI |
| **Trust Folders** | ✅ 100% | Directory-level tool permissions via `.codebuddy-trust.json` |
| **Agent Profiles** | ✅ 100% | Predefined agent configs (secure, minimal, power-user) |
| **Tool Streaming** | ✅ 100% | Real-time bash output via AsyncGenerator |
| **TabbedQuestion UI** | ✅ 100% | Multi-option interactive prompts |

### Phase 4 — Autonomous Agent

| Module | Status | Description |
|:-------|:------:|:------------|
| **Daemon Mode** | ✅ 100% | Background process with PID management, auto-restart (max 3) |
| **Cron-Agent Bridge** | ✅ 100% | Scheduled task execution via CodeBuddyAgent instances |
| **Task Planner** | ✅ 100% | DAG-based decomposition with topological sort and parallel execution |
| **Screen Observer** | ✅ 100% | Periodic screenshots, perceptual diff, event triggers |
| **Proactive Agent** | ✅ 100% | Push notifications, question/response, rate limiting, quiet hours |
| **Orchestrator** | ✅ 100% | Multi-agent supervisor (sequential/parallel/race/all strategies) |
| **Self-Healing** | ✅ 100% | Error pattern recognition, auto-recovery with exponential backoff |
| **Checkpoint Rollback** | ✅ 100% | Auto-checkpoint before risky ops, rollback to last good state |
| **Shared Context** | ✅ 100% | Thread-safe key-value store with optimistic locking |

### Phase 5 — OpenClaw-Inspired Platform

| Module | Status | Description |
|:-------|:------:|:------------|
| **Doctor Command** | ✅ 100% | Environment/deps/config diagnostics (`buddy doctor`) |
| **Onboarding Wizard** | ✅ 100% | Interactive setup wizard (`buddy onboard`) |
| **Model Failover Chain** | ✅ 100% | Cascading provider fallback with health tracking |
| **Webhook Triggers** | ✅ 100% | HMAC-verified HTTP triggers + CLI + API routes |
| **Typing Indicators** | ✅ 100% | Presence & typing events for channels |
| **Live Canvas** | ✅ 100% | WebSocket-driven visual workspace (A2UI) |
| **Docker Sandbox** | ✅ 100% | Containerized command execution with resource limits |
| **Skills Registry** | ✅ 100% | Bundled/managed/workspace skills with YAML frontmatter |
| **Media Pipeline** | ✅ 100% | Ingest, track, transcode with transcription hooks |
| **ACP Protocol** | ✅ 100% | Inter-agent communication router with request/response |
| **Extension System** | ✅ 100% | Manifest-based plugin loader with lifecycle hooks |
| **Copilot Proxy** | ✅ 100% | IDE-compatible completions backend (`/v1/completions`) |

---

## Installation

### Prerequisites

- **Node.js** 18.0.0 or higher
- **ripgrep** (recommended for faster search)

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

# Or try without installing
npx @phuetz/code-buddy@latest
```

---

## Quick Start

```bash
# Configure API key (Grok/xAI)
export GROK_API_KEY=your_api_key

# Start interactive mode
buddy

# Or with a specific task
buddy --prompt "analyze the codebase structure"

# Use with local LLM (LM Studio)
buddy --profile lmstudio

# Full autonomy mode
YOLO_MODE=true buddy
```

### Typical Project Workflow

```bash
# 1. First-time setup
buddy onboard                # Interactive config wizard
buddy doctor                 # Verify environment & dependencies

# 2. Start coding
buddy                        # Launch interactive chat

# 3. Describe what you want in natural language
> "Create a Node.js project with Express and Prisma"
> "Add Google OAuth authentication"
> "Write tests for the auth module"
> "Fix the typecheck errors"
> "Commit everything"

# 4. Advanced modes
buddy --profile gemini       # Switch AI provider
buddy speak                  # Voice conversation mode
buddy daemon start           # Run 24/7 in background
buddy server --port 3000     # Expose REST/WebSocket API
```

Code Buddy autonomously reads files, writes code, runs commands, and fixes errors — typically 5-15 tool calls per task (up to 50, or 400 in YOLO mode).

---

## Architecture

Code Buddy uses a **facade architecture** for clean separation of concerns:

```
CodeBuddyAgent
    │
    ├── AgentContextFacade      # Context window and memory management
    │       - Token counting, compression, memory retrieval
    │
    ├── SessionFacade           # Session persistence and checkpoints
    │       - Save/load, checkpoint creation, rewind
    │
    ├── ModelRoutingFacade      # Model routing and cost tracking
    │       - Provider selection, cost calculation
    │
    ├── InfrastructureFacade    # MCP, sandbox, hooks, plugins
    │       - Hook execution, plugin loading
    │
    └── MessageHistoryManager   # Chat and LLM message history
```

### Autonomy Layer (Phase 4)

```
CodeBuddyAgent
    │
    ├── TaskPlanner             # DAG decomposition of complex requests
    │       - needsPlanning() heuristic
    │       - createPlan() → TaskGraph → parallel execution
    │
    ├── SupervisorAgent         # Multi-agent orchestration
    │       - Sequential, parallel, race, all strategies
    │       - SharedContext with optimistic locking
    │
    ├── SelfHealing             # Automatic error recovery
    │       - Pattern recognition (6 built-in patterns)
    │       - Retry with exponential backoff
    │
    ├── ScreenObserver          # Environment monitoring
    │       - Periodic screenshots with perceptual diff
    │       - Event triggers (file_change, screen_change, time, webhook)
    │
    ├── ProactiveAgent          # Agent-initiated communication
    │       - Push notifications with priority levels
    │       - Rate limiting and quiet hours
    │
    └── DaemonManager           # Background process lifecycle
            - PID file management, auto-restart
            - Service registry, health monitoring
```

### Core Flow

```
User Input → ChatInterface (Ink/React) → CodeBuddyAgent → AI Provider
                                              │
                                         Tool Calls (max 50/400 rounds)
                                              │
                                      Tool Execution + Confirmation
                                              │
                                        Results back to API (loop)
```

---

## AI Providers

Code Buddy supports multiple AI providers with automatic failover:

| Provider | Models | Context | Configuration |
|:---------|:-------|:--------|:--------------|
| **Grok** (xAI) | grok-4, grok-code-fast-1 | 128K | `GROK_API_KEY` |
| **Claude** (Anthropic) | claude-sonnet-4, opus | 200K | `ANTHROPIC_API_KEY` |
| **ChatGPT** (OpenAI) | gpt-4o, gpt-4-turbo | 128K | `OPENAI_API_KEY` |
| **Gemini** (Google) | gemini-2.0-flash (+ vision) | 2M | `GOOGLE_API_KEY` |
| **LM Studio** | Any local model | Varies | `--profile lmstudio` |
| **Ollama** | llama3, codellama, etc. | Varies | `--profile ollama` |

### Connection Profiles

Switch between providers instantly:

```bash
# List profiles
buddy --list-profiles

# Use specific profile
buddy --profile lmstudio

# Auto-detect local servers
buddy --detect-servers
```

### Profile Configuration

```json
// ~/.codebuddy/user-settings.json
{
  "connection": {
    "activeProfileId": "grok",
    "profiles": [
      {
        "id": "grok",
        "name": "Grok API (xAI)",
        "provider": "grok",
        "baseURL": "https://api.x.ai/v1",
        "model": "grok-4-latest"
      },
      {
        "id": "lmstudio",
        "name": "LM Studio Local",
        "provider": "lmstudio",
        "baseURL": "http://localhost:1234/v1",
        "apiKey": "lm-studio"
      }
    ]
  }
}
```

---

## Memory System

Code Buddy features a sophisticated memory system inspired by OpenClaw:

### Three Memory Subsystems

| Subsystem | Storage | Purpose |
|:----------|:--------|:--------|
| **Persistent Memory** | Markdown files | Project/user notes |
| **Enhanced Memory** | SQLite + embeddings | Semantic search |
| **Prospective Memory** | SQLite | Tasks, goals, reminders |

### Auto-Capture (OpenClaw Pattern)

Automatically detects and stores important information:

```typescript
// Detected patterns (English + French)
"Remember that..."        → Stored as instruction
"I prefer..."             → Stored as preference
"This project uses..."    → Stored as project fact
"My email is..."          → Stored as contact info
"We decided to..."        → Stored as decision
```

### Memory Lifecycle Hooks

```typescript
// Before execution: Inject relevant memories
beforeExecute(context) → { injectedContext, recalledMemories }

// After response: Capture important info
afterResponse(context) → { capturedCount, capturedMemories }

// Session end: Summarize conversation
sessionEnd(sessionId) → { summaryId, memoriesStored }
```

### Deduplication

- Jaccard similarity threshold: 0.95
- Hash-based recent capture cache
- Automatic duplicate detection

---

## Multi-Channel Support

Code Buddy supports multiple messaging channels:

| Channel | Status | Features |
|:--------|:------:|:---------|
| **Discord** | 🟡 Base | Bot integration, slash commands |
| **Telegram** | 🟡 Base | Bot API, message handlers |
| **Slack** | 🟡 Base | Bolt framework, events |
| **Terminal** | ✅ Full | Native CLI interface |
| **HTTP API** | ✅ Full | REST + WebSocket |

### Channel Configuration

```typescript
// Enable Discord channel
const discord = new DiscordChannel({
  token: process.env.DISCORD_TOKEN,
  allowedGuilds: ['guild-id'],
});
await discord.connect();
```

---

## Security

### Tool Policy System

Fine-grained control over tool execution:

```typescript
const policy = new ToolPolicy({
  allowlist: ['read_file', 'search', 'web_fetch'],
  denylist: ['bash', 'write_file'],
  requireConfirmation: ['delete_file'],
});
```

### Bash Allowlist

Secure command execution:

```typescript
const bashPolicy = new BashAllowlist({
  patterns: [
    /^npm (install|test|run)/,
    /^git (status|diff|log)/,
    /^ls -la?/,
  ],
  blocked: [
    /rm -rf/,
    /sudo/,
    /curl.*\|.*sh/,
  ],
});
```

### Security Modes

| Mode | Description |
|:-----|:------------|
| `suggest` | Confirm all operations |
| `auto-edit` | Auto-approve safe ops |
| `full-auto` | Full autonomy (YOLO) |

```bash
/mode suggest    # Maximum safety
/mode full-auto  # Full autonomy
```

### Sandbox Isolation

Docker-based execution environment:

```typescript
const sandbox = new DockerSandbox({
  image: 'codebuddy/sandbox:latest',
  memoryLimit: '512m',
  networkMode: 'none',
  timeout: 30000,
});
```

---

## Context Management

### Context Window Guard

Automatic context management with configurable thresholds:

```typescript
const guard = new ContextWindowGuard({
  maxTokens: 128000,
  warningThreshold: 0.8,  // Warn at 80%
  compactionThreshold: 0.9,  // Compact at 90%
});
```

### Smart Compaction

Multi-stage compression:

1. **Stage 1**: Remove tool results older than TTL
2. **Stage 2**: Summarize older messages
3. **Stage 3**: Aggressive truncation if needed

### Hybrid Search

Combined keyword + semantic search:

```typescript
const results = await hybridSearch({
  query: "authentication flow",
  keywordWeight: 0.3,
  semanticWeight: 0.7,
});
```

---

## Tools

### Built-in Tools

| Category | Tools |
|:---------|:------|
| **File Operations** | `view_file`, `create_file`, `str_replace_editor`, `edit_file`, `multi_edit` |
| **Search** | `search`, `codebase_map` |
| **System** | `bash`, `docker`, `kubernetes` |
| **Web** | `web_search`, `web_fetch`, `browser` |
| **Planning** | `create_todo_list`, `get_todo_list`, `update_todo_list` |
| **Media** | `screenshot`, `audio`, `video`, `ocr`, `clipboard` |
| **Documents** | `pdf`, `document`, `archive` |

### RAG-Based Tool Selection

Tools are selected based on query relevance:

```typescript
// Query: "what's the weather in Paris?"
// Selected tools: web_search, web_fetch
// Not selected: bash, edit_file, etc.
```

---

## API Server

REST API with WebSocket support:

### Starting the Server

```bash
buddy server --port 3000
```

### Endpoints

| Endpoint | Method | Description |
|:---------|:-------|:------------|
| `/api/health` | GET | Health check |
| `/api/metrics` | GET | Prometheus metrics |
| `/api/chat` | POST | Chat completion |
| `/api/chat/completions` | POST | OpenAI-compatible |
| `/api/tools` | GET | List tools |
| `/api/tools/{name}/execute` | POST | Execute tool |
| `/api/sessions` | GET/POST | Session management |
| `/api/memory` | GET/POST | Memory entries |
| `/api/daemon/status` | GET | Daemon status |
| `/api/daemon/health` | GET | Health metrics (CPU, memory) |
| `/api/cron/jobs` | GET | List cron jobs |
| `/api/cron/jobs/{id}/trigger` | POST | Trigger a cron job |
| `/api/notifications/preferences` | GET/POST | Notification settings |

### WebSocket Events

```javascript
const ws = new WebSocket('ws://localhost:3000/ws');

// Authenticate
ws.send(JSON.stringify({
  type: 'authenticate',
  payload: { token: 'jwt-token' }
}));

// Stream chat
ws.send(JSON.stringify({
  type: 'chat_stream',
  payload: { messages: [{ role: 'user', content: 'Hello' }] }
}));
```

---

## Slash Commands

| Command | Description |
|:--------|:------------|
| `/help` | Show help |
| `/model [name]` | Change model |
| `/mode [mode]` | Change security mode |
| `/profile [id]` | Switch connection profile |
| `/think` | Enable reasoning (4K tokens) |
| `/megathink` | Deep reasoning (10K tokens) |
| `/ultrathink` | Exhaustive reasoning (32K tokens) |
| `/cost` | Show cost dashboard |
| `/memory` | Memory management |
| `/hooks list` | List lifecycle hooks |
| `/plugin list` | List plugins |

### Daemon Commands

```bash
buddy daemon start [--detach]  # Start background daemon
buddy daemon stop              # Stop daemon
buddy daemon restart           # Restart daemon
buddy daemon status            # Show daemon status and services
buddy daemon logs [--lines N]  # View daemon logs
```

### Trigger Commands

```bash
buddy trigger list             # List all event triggers
buddy trigger add <pattern> <action>  # Add a trigger
buddy trigger remove <id>      # Remove a trigger
```

### Voice & TTS Commands

```bash
buddy speak "Bonjour, je suis Code Buddy"   # Synthesize and play speech
buddy speak --voice af_bella "Hello world"   # Use a specific voice
buddy speak --list-voices                    # List available voices
buddy speak --speed 1.5 "Fast speech"        # Adjust speed (0.25-4.0)
buddy speak --format mp3 "Hello"             # Output format (wav, mp3)
buddy speak --url http://host:8000 "Hello"   # Custom AudioReader URL
```

**In-chat voice commands:**

| Command | Description |
|:--------|:------------|
| `/speak <text>` | Speak text with current TTS provider |
| `/tts on\|off` | Enable/disable TTS |
| `/tts auto` | Auto-speak all agent responses |
| `/tts provider audioreader` | Switch to AudioReader (Kokoro-82M, local, free) |
| `/tts voice ff_siwis` | Set voice (e.g., `ff_siwis` FR, `af_bella` EN) |

**Supported TTS providers:** Edge TTS, espeak, macOS `say`, Piper, OpenAI, ElevenLabs, AudioReader (Kokoro-82M)

**Infinite voice conversation:** Enable `continuousListening` + `autoSpeak` with AudioReader for a hands-free loop: listen → STT → agent → TTS → listen.

---

## Plugin System

### Plugin Structure

```
~/.codebuddy/plugins/
  my-plugin/
    manifest.json
    index.js
```

### Plugin Types

- **Tool Plugins**: Add custom tools
- **Provider Plugins**: Add LLM/embedding/search providers
- **Command Plugins**: Add slash commands
- **Hook Plugins**: Add lifecycle hooks

### Example Plugin

```typescript
const plugin: Plugin = {
  async activate(context: PluginContext) {
    context.registerTool({
      name: 'my_tool',
      description: 'Custom tool',
      execute: async (args) => {
        return { success: true, output: 'Done!' };
      }
    });

    context.registerProvider({
      id: 'my-llm',
      type: 'llm',
      async chat(messages) { return 'response'; }
    });
  }
};
```

---

## Bundled Skills (25)

Code Buddy includes 25 built-in SKILL.md files that provide domain-specific knowledge and best practices. Skills are loaded contextually when relevant to your project.

| Category | Skill | Description |
|----------|-------|-------------|
| **PR Workflow** | `review-pr` | Code review checklist, inline comments, approval criteria |
| | `prepare-pr` | Branch naming, commit cleanup, PR description template |
| | `merge-pr` | Merge strategies, conflict resolution, post-merge cleanup |
| **Dev Tools** | `github` | Issues, releases, Actions workflows, gh CLI |
| | `session-logs` | Export/search conversation history and session metadata |
| | `model-usage` | Token tracking, cost analysis, provider comparison |
| | `tmux-sessions` | Terminal multiplexing, pane layouts, session management |
| | `healthcheck` | Service monitoring, endpoint checks, alerting |
| **Project** | `project-best-practices` | Project scaffolding, structure, linting, testing conventions |
| | `csharp-avalonia` | Cross-platform desktop/mobile with C# and Avalonia UI |
| | `coding-agent` | Autonomous multi-step coding with planning and validation |
| | `skill-creator` | Author new SKILL.md files with YAML frontmatter |
| **Utilities** | `summarize` | Text/file/URL summarization with configurable length |
| | `weather` | Weather lookups via wttr.in and OpenWeatherMap |
| **Media** | `image-gen` | Image generation via DALL-E, Stable Diffusion, Midjourney |
| | `whisper-transcribe` | Audio/video transcription with OpenAI Whisper |
| | `pdf-tools` | PDF creation, merging, text extraction, conversion |
| | `screenshot` | Screen capture, annotation, OCR text extraction |
| | `video-tools` | FFmpeg video editing, conversion, thumbnails, GIFs |
| | `gif-search` | GIF search via Giphy and Tenor APIs |
| **Communication** | `email-tools` | Email send/read via himalaya CLI and SMTP |
| | `notion` | Notion API for pages, databases, search, content blocks |
| | `blog-watcher` | RSS/Atom feed monitoring, web page change detection |
| **Smart Home** | `spotify` | Spotify playback control via spotify_player and Web API |
| | `smart-home` | Philips Hue and Home Assistant control |

Skills are stored in `.codebuddy/skills/bundled/` and can be extended with managed or workspace skills via the Skills Registry.

---

## Development

```bash
# Clone and install
git clone https://github.com/phuetz/code-buddy.git
cd code-buddy
npm install

# Development mode
npm run dev

# Run tests
npm test

# Validate before commit
npm run validate

# Build
npm run build
```

### Test Coverage

```
340+ tests across 25+ suites:
- Tool Policy System (2 suites)
- Bash Allowlist (2 suites)
- Context Window Guard (34 tests)
- Context Compaction (4 suites)
- Moltbot Hooks (52 tests)
- Connection Profiles (57 tests)
- Desktop Automation (100 tests)
- Middleware Pipeline (pipeline tests)
- Agent Profiles & Streaming (reasoning, profiles)
- Daemon Manager & Cron Bridge (lifecycle, PID, jobs)
- Task Planner & Delegation (DAG, topological sort)
- Screen Observer & Triggers (capture, diff, cooldown)
- Proactive Agent & Notifications (rate limit, quiet hours)
- Orchestrator (supervisor, shared context, self-healing, rollback)
```

---

## Configuration

### Environment Variables

| Variable | Description | Default |
|:---------|:------------|:--------|
| `GROK_API_KEY` | xAI API key | Required |
| `ANTHROPIC_API_KEY` | Anthropic API key | - |
| `OPENAI_API_KEY` | OpenAI API key | - |
| `GOOGLE_API_KEY` | Google AI API key | - |
| `SERPER_API_KEY` | Web search API key | - |
| `GROK_BASE_URL` | Custom API endpoint | - |
| `GROK_MODEL` | Default model | - |
| `YOLO_MODE` | Full autonomy | `false` |
| `MAX_COST` | Cost limit ($) | `10` |
| `JWT_SECRET` | API server auth | Required in prod |

### Project Settings

Create `.codebuddy/settings.json`:

```json
{
  "systemPrompt": "You are working on a TypeScript project.",
  "tools": {
    "enabled": ["read_file", "search", "bash"],
    "disabled": ["web_search"]
  },
  "security": {
    "mode": "auto-edit",
    "bashAllowlist": ["npm *", "git *"]
  }
}
```

---

## Roadmap

### Planned Features

| Feature | Priority | Status |
|:--------|:---------|:-------|
| Daemon Mode (background agent) | HIGH | ✅ Done |
| Task Planner (DAG decomposition) | HIGH | ✅ Done |
| Screen Observer & Triggers | HIGH | ✅ Done |
| Proactive Agent (push notifications) | HIGH | ✅ Done |
| Multi-Agent Orchestrator | HIGH | ✅ Done |
| Self-Healing & Checkpoint Rollback | HIGH | ✅ Done |
| Gateway WebSocket Control Plane | HIGH | 🔲 Planned |
| Canvas A2UI Visual Workspace | HIGH | ✅ Done |
| ClawHub Skills Registry | MEDIUM | ✅ Done |
| OAuth Authentication | MEDIUM | 🔲 Planned |
| Voice Wake Word Detection | MEDIUM | ✅ Done |
| TTS Providers (OpenAI, ElevenLabs, AudioReader) | MEDIUM | ✅ Done |
| Companion Apps (iOS, Android, macOS) | LOW | 🔲 Planned |
| Tailscale Integration | LOW | 🔲 Planned |

---

## Troubleshooting

### Common Issues

**API key not working**
```bash
echo $GROK_API_KEY  # Verify key is set
buddy --prompt "test"
```

**Switching profiles doesn't work**
```bash
# Check current profile
buddy --show-config

# Force profile switch
buddy --profile lmstudio --prompt "test"
```

**Memory not persisting**
```bash
# Check memory directory
ls ~/.codebuddy/memory/

# Clear and reinitialize
rm -rf ~/.codebuddy/memory/
buddy
```

**High latency**
- Use a faster model: `buddy --model grok-code-fast-1`
- Use local LLM: `buddy --profile ollama`

### Debug Mode

```bash
DEBUG=codebuddy:* buddy
```

---

## License

MIT License - see [LICENSE](LICENSE) for details.

---

<div align="center">

**[Report Bug](https://github.com/phuetz/code-buddy/issues)** |
**[Request Feature](https://github.com/phuetz/code-buddy/discussions)** |
**[Star on GitHub](https://github.com/phuetz/code-buddy)**

<sub>Inspired by [OpenClaw](https://github.com/openclaw/openclaw) | Multi-AI: Grok | Claude | ChatGPT | Gemini | LM Studio | Ollama</sub>

</div>
