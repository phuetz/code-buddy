<div align="center">

<img src="https://img.shields.io/badge/🤖-Code_Buddy-blueviolet?style=for-the-badge&labelColor=1a1a2e" alt="Code Buddy"/>

# Code Buddy

### Your AI-Powered Development Tool & Personal Assistant

<p align="center">
  <a href="https://www.npmjs.com/package/@phuetz/code-buddy"><img src="https://img.shields.io/npm/v/@phuetz/code-buddy.svg?style=flat-square&color=ff6b6b&label=version" alt="npm version"/></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-feca57.svg?style=flat-square" alt="License: MIT"/></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D18.0.0-54a0ff?style=flat-square&logo=node.js" alt="Node Version"/></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.3-5f27cd?style=flat-square&logo=typescript" alt="TypeScript"/></a>
  <a href="https://deepwiki.com/phuetz/code-buddy/"><img src="https://deepwiki.com/badge.svg" alt="Ask DeepWiki"/></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Tests-23%2C700%2B-00d26a?style=flat-square&logo=jest" alt="Tests"/>
  <img src="https://img.shields.io/badge/Coverage-85%25-48dbfb?style=flat-square" alt="Coverage"/>
  <img src="https://img.shields.io/badge/Build-passing-00d26a?style=flat-square" alt="Build"/>
</p>

<br/>

**A multi-AI terminal agent that writes code, runs commands, searches the web, talks to you, and manages your projects — from your terminal, your phone, or running 24/7 in the background.**

<br/>

[Quick Start](#quick-start) |
[Development Tool](#development-tool) |
[Personal Assistant](#personal-assistant) |
[Channels](#multi-channel-messaging) |
[Autonomous Agent](#autonomous-agent) |
[Security](#security--trust) |
[CLI Reference](#cli-reference) |
[API](#api-server--integrations)

</div>

---

## What is Code Buddy?

Code Buddy is an open-source multi-provider AI coding agent that runs in your terminal. It supports **Grok, Claude, ChatGPT, Gemini, LM Studio, and Ollama** via OpenAI-compatible APIs and provider-specific SDKs.

It works as two things at once:

- **A development tool** — reads files, writes code, runs commands, creates PRs, plans complex tasks, and fixes its own mistakes across 5-50 tool calls per task.
- **A personal assistant** — talks to you by voice, remembers your preferences, monitors your screen, sends notifications to your phone via Telegram/Discord/Slack, and runs scheduled tasks 24/7 in the background.

**Key highlights:**
- 6 AI providers with automatic failover
- 40 bundled skills (PR workflow, DevOps, creative tools, smart home, media)
- 11 messaging channels (Terminal, Telegram, Discord, Slack, WhatsApp, Signal, Teams, Matrix, Google Chat, WebChat, HTTP API)
- Daemon mode for 24/7 background operation
- Multi-agent orchestration with self-healing
- Voice conversation with wake word detection
- Docker sandbox for safe command execution

---

## Quick Start

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

### Install

```bash
# npm (recommended)
npm install -g @phuetz/code-buddy

# Or try without installing
npx @phuetz/code-buddy@latest
```

### First Run

```bash
# Configure API key (Grok/xAI)
export GROK_API_KEY=your_api_key

# Start interactive mode
buddy

# Or with a specific task
buddy --prompt "analyze the codebase structure"

# Use with local LLM (LM Studio)
buddy --base-url http://localhost:1234/v1 --api-key lm-studio

# Full autonomy mode
YOLO_MODE=true buddy
```

### Headless Mode (CI / Scripting)

```bash
# Single prompt, JSON output to stdout (logs go to stderr)
buddy -p "create a hello world Express app" --output-format json > result.json

# Pipe into other tools
buddy -p "explain this code" --output-format json 2>/dev/null | jq '.content'

# Use in CI with full autonomy
buddy -p "run tests and fix failures" \
  --dangerously-skip-permissions \
  --output-format json \
  --max-tool-rounds 30

# Auto-approve all tool executions (no confirmation prompts)
buddy -p "fix lint errors" --auto-approve --output-format text
```

Headless mode exits cleanly after completion — safe for `timeout`, shell scripts, and CI pipelines.

### Session Management

```bash
# Continue the most recent session
buddy --continue

# Resume a specific session by ID (supports partial matching)
buddy --resume abc123

# Set a cost limit for the session
buddy --max-price 5.00
```

### Typical Project Workflow

```bash
# 1. First-time setup
buddy --setup                # Quick API key setup wizard
buddy onboard                # Full interactive config wizard
buddy doctor                 # Verify environment & dependencies

# 2. Start coding
buddy                        # Launch interactive chat
buddy --vim                  # Launch with Vim keybindings

# 3. Describe what you want in natural language
> "Create a Node.js project with Express and Prisma"
> "Add Google OAuth authentication"
> "Write tests for the auth module"
> "Fix the typecheck errors"
> "Commit everything"

# 4. Advanced modes
buddy --model gemini-2.5-flash  # Switch AI model
buddy --system-prompt architect # Use architect system prompt
buddy --agent my-custom-agent   # Use custom agent from ~/.codebuddy/agents/
buddy speak                     # Voice conversation mode
buddy daemon start              # Run 24/7 in background
buddy server --port 3000        # Expose REST/WebSocket API
```

Code Buddy autonomously reads files, writes code, runs commands, and fixes errors — typically 5-15 tool calls per task (up to 50, or 400 in YOLO mode).

---

## Development Tool

### Agentic Coding

Code Buddy operates as an autonomous coding agent. It reads your codebase, makes changes, runs commands, and iterates until the task is done.

**Built-in tools:**

| Category | Tools |
|:---------|:------|
| **File Operations** | `view_file`, `create_file`, `str_replace_editor`, `edit_file`, `multi_edit` |
| **Search** | `search`, `codebase_map` |
| **System** | `bash`, `docker`, `kubernetes` |
| **Web** | `web_search`, `web_fetch`, `browser` |
| **Patching** | `apply_patch` (unified diff with fuzz factor, Codex-inspired) |
| **Planning** | `create_todo_list`, `get_todo_list`, `update_todo_list` |
| **Media** | `screenshot`, `audio`, `video`, `ocr`, `clipboard` |
| **Documents** | `pdf`, `document`, `archive` |

**RAG-based tool selection** filters tools per query to reduce prompt tokens — only relevant tools are included in each API call.

### Code Intelligence

**Web Search (5-Provider Fallback Chain):**

| Priority | Provider | API Key Required | Features |
|:---------|:---------|:-----------------|:---------|
| 1 | **Brave MCP** | `BRAVE_API_KEY` + MCP enabled | Full MCP integration, richest results |
| 2 | **Brave API** | `BRAVE_API_KEY` | Country, language, freshness filters |
| 3 | **Perplexity** | `PERPLEXITY_API_KEY` or `OPENROUTER_API_KEY` | AI-synthesized answers with citations |
| 4 | **Serper** | `SERPER_API_KEY` | Google Search results |
| 5 | **DuckDuckGo** | None | Free fallback (no API key needed) |

Search parameters: `country` (ISO 3166), `search_lang`, `ui_lang`, `freshness` (`pd`/`pw`/`pm`/`py` or date range), `provider` (force specific).

**Context management** uses smart multi-stage compaction (remove stale tool results, summarize older messages, aggressive truncation) to keep conversations within token limits across long sessions.

**Hybrid search** combines keyword + semantic search with configurable weights for memory retrieval.

### Code Safety

Code Buddy validates everything before it touches your files:

| Feature | Description |
|:--------|:------------|
| **Generated Code Validator** | Pre-write scan for eval, XSS, SQL injection, hardcoded secrets, prototype pollution |
| **Pre-Write Syntax Validator** | Balanced delimiters, template literals, indentation (JS/TS/Python/YAML/HTML/CSS/JSON) |
| **Atomic Rollback (apply-patch)** | All-or-nothing patch application with full file state backup |
| **Atomic Transactions (multi-edit)** | Multi-file edits rolled back on first failure |
| **AST Bash Validation** | tree-sitter-based command parsing with centralized dangerous pattern checks |
| **Bash Checkpoints** | Pre-snapshot of files targeted by destructive commands (rm, mv, truncate) |
| **Diff Preview** | Shows actual diffs before approval, magnitude-based re-confirmation for large changes |
| **Semantic Truncation** | Error-preserving output truncation (keeps error lines and stack traces) |
| **Security Audit Logging** | JSONL audit trail for all code generation security decisions |

### Task Planning

For complex multi-step requests, Code Buddy decomposes work into a **DAG (directed acyclic graph)** and executes steps in parallel where possible.

- **TaskPlanner** — `needsPlanning()` heuristic detects complex requests, `createPlan()` produces a TaskGraph
- **Topological sort** — determines execution order with dependency tracking
- **Parallel execution** — independent steps run concurrently via dependency waves
- **Architect mode** — `--system-prompt architect` enables plan-first coding with per-step checkpoints

### CI/CD Integration

| Feature | Description |
|:--------|:------------|
| **CI Watcher** | GitHub Actions / GitLab CI / Jenkins alerts with "Fix it" auto-agent |
| **Webhook Triggers** | HMAC-SHA256 verified HTTP triggers — connect CI, monitoring, or any service |
| **Headless Mode** | `buddy -p "run tests and fix failures" --dangerously-skip-permissions` for CI pipelines |

### Git Workflow

Code Buddy handles the full Git lifecycle through natural language:

```
> "Create a PR for the auth changes"
> "Review the open PRs"
> "Fix the merge conflicts on feature-branch"
> "Commit everything with a good message"
```

**Telegram enhanced commands** for remote Git operations:

| Command | Description |
|:--------|:------------|
| `/repo` | Repository info, recent commits, open PRs |
| `/branch [name]` | Branch diff stats vs main |
| `/pr [number]` | List or view PRs with merge/review buttons |

---

## Personal Assistant

### Voice Conversation

Full hands-free voice interaction with wake word detection:

```bash
buddy speak "Hello, I am Code Buddy"         # Synthesize and play speech
buddy speak --voice af_bella "Hello world"    # Use a specific voice
buddy speak --list-voices                     # List available voices
buddy speak --speed 1.5 "Fast speech"         # Adjust speed (0.25-4.0)
buddy speak --format mp3 "Hello"              # Output format (wav, mp3)
buddy speak --url http://host:8000 "Hello"    # Custom AudioReader URL
```

**7 TTS providers:** Edge TTS, espeak, macOS `say`, Piper, OpenAI, ElevenLabs, AudioReader (Kokoro-82M local)

**In-chat voice commands:**

| Command | Description |
|:--------|:------------|
| `/speak <text>` | Speak text with current TTS provider |
| `/tts on\|off` | Enable/disable TTS |
| `/tts auto` | Auto-speak all agent responses |
| `/tts provider audioreader` | Switch to AudioReader (Kokoro-82M, local, free) |
| `/tts voice ff_siwis` | Set voice (e.g., `ff_siwis` FR, `af_bella` EN) |

**Wake word detection** via Porcupine (Picovoice) with text-match fallback. Set `PICOVOICE_ACCESS_KEY` for hardware-accelerated detection, or use the built-in text matcher for free.

**Infinite voice conversation:** Enable `continuousListening` + `autoSpeak` with AudioReader for a hands-free loop: listen → STT → agent → TTS → listen.

### Memory System

| Subsystem | Storage | Purpose |
|:----------|:--------|:--------|
| **Persistent Memory** | Markdown files | Project/user notes |
| **Enhanced Memory** | SQLite + embeddings | Semantic search |
| **Prospective Memory** | SQLite | Tasks, goals, reminders |
| **ICM (optional)** | [ICM MCP server](https://github.com/rtk-ai/icm) | Persistent cross-session memory via episodic + semantic dual architecture |

**Auto-capture** detects and stores important information from conversations:

```
"Remember that..."        → Stored as instruction
"I prefer..."             → Stored as preference
"This project uses..."    → Stored as project fact
"My email is..."          → Stored as contact info
"We decided to..."        → Stored as decision
```

**Memory lifecycle hooks** inject relevant memories before execution, capture important info after responses, and summarize conversations at session end. Deduplication via Jaccard similarity (0.95 threshold) prevents duplicates.

### Skills Library (40 Bundled Skills)

Code Buddy includes 40 built-in SKILL.md files that provide domain-specific knowledge, best practices, and MCP server integration. Skills are loaded contextually when relevant to your project.

| Category | Skill | Description |
|----------|-------|-------------|
| **PR Workflow** | `review-pr` | Code review checklist, inline comments, approval criteria |
| | `prepare-pr` | Branch naming, commit cleanup, PR description template |
| | `merge-pr` | Merge strategies, conflict resolution, post-merge cleanup |
| **Dev Tools** | `github` | Issues, releases, Actions workflows, gh CLI |
| | `gitlab` | GitLab API, glab CLI, CI/CD pipelines, merge requests |
| | `session-logs` | Export/search conversation history and session metadata |
| | `model-usage` | Token tracking, cost analysis, provider comparison |
| | `tmux-sessions` | Terminal multiplexing, pane layouts, session management |
| | `healthcheck` | Service monitoring, endpoint checks, alerting |
| **Project** | `project-best-practices` | Project scaffolding, structure, linting, testing conventions |
| | `csharp-avalonia` | Cross-platform desktop/mobile with C# and Avalonia UI |
| | `coding-agent` | Autonomous multi-step coding with planning and validation |
| | `skill-creator` | Author new SKILL.md files with YAML frontmatter |
| **Creative & 3D** | `blender` | Python bpy scripting, CLI rendering, Geometry Nodes |
| | `unreal-engine` | Remote Control API, Python editor scripting, Movie Render Queue |
| | `davinci-resolve` | DaVinciResolveScript Python API, color grading, render queue |
| | `ableton-live` | OSC protocol, MIDI Remote Scripts, Max for Live |
| **Design** | `figma` | REST API, Plugin API, design tokens extraction |
| | `gimp` | Python-Fu / Script-Fu scripting, batch image processing |
| | `inkscape` | Extensions API, CLI export, SVG manipulation |
| **DevOps & Infra** | `kubernetes` | kubectl, Helm, ArgoCD GitOps |
| | `terraform-ansible` | Terraform IaC + Ansible configuration management |
| | `grafana-prometheus` | Grafana HTTP API, PromQL, alerting pipelines |
| | `jenkins-ci` | Jenkins API, Groovy pipelines, shared libraries |
| **Workflow & Data** | `n8n` | REST API, webhook triggers, workflow automation |
| | `databases` | PostgreSQL, MongoDB, Redis CLI and automation |
| | `game-engines` | Unity C# + Godot GDScript, builds, scene management |
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

Each skill includes **Direct Control** (CLI/API/scripting commands), **MCP Server Integration** (config for `.codebuddy/mcp.json`), and **Common Workflows** (step-by-step recipes). Skills are stored in `.codebuddy/skills/bundled/` and can be extended with managed or workspace skills via the Skills Registry and Hub.

### Proactive Notifications

The agent can reach out to you — not just respond:

- **Push notifications** with priority levels (info, warning, critical)
- **Rate limiting** prevents notification spam
- **Quiet hours** — suppress non-critical notifications during configured periods
- **Multi-channel delivery** — notifications route to Telegram, Discord, Slack, or any connected channel

### Screen Observer

Monitor your screen and environment for events:

- **Periodic screenshots** with perceptual diff detection
- **Event triggers** — `file_change`, `screen_change`, `time`, `webhook`
- **Trigger registry** — add/remove triggers dynamically

```bash
buddy trigger list             # List all event triggers
buddy trigger add <spec>       # Add a trigger (format: type:condition action:target)
buddy trigger remove <id>      # Remove a trigger
```

---

## Multi-Channel Messaging

Code Buddy supports 11 messaging channels:

| Channel | Features |
|:--------|:---------|
| **Terminal** | Native CLI interface (Ink/React) |
| **HTTP API** | REST + WebSocket |
| **WebChat** | Built-in HTTP + WebSocket with browser UI |
| **Discord** | Bot integration, slash commands |
| **Telegram** | Bot API, pro features, scoped auth, CI watcher |
| **Slack** | Bolt framework, events |
| **WhatsApp** | Baileys (QR pairing, media, reconnect) |
| **Signal** | signal-cli REST API (polling, groups) |
| **Google Chat** | Workspace API (JWT auth, webhook events) |
| **Microsoft Teams** | Bot Framework (OAuth2, adaptive cards) |
| **Matrix** | matrix-js-sdk (E2EE, threads, media) |

### Telegram (Deep Dive)

Telegram is the most feature-rich channel, giving you full agent capabilities from your phone.

**Setup:**

1. Create a bot with [@BotFather](https://t.me/BotFather) on Telegram (`/newbot`)
2. Configure the token:

```bash
export TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
```

Or in `.codebuddy/settings.json`:

```json
{
  "channels": {
    "telegram": {
      "type": "telegram",
      "token": "123456:ABC-DEF...",
      "adminUsers": ["your_telegram_user_id"],
      "defaultParseMode": "Markdown"
    }
  }
}
```

3. Start Code Buddy with Telegram:

```bash
buddy --channel telegram        # Interactive with Telegram
buddy daemon start              # 24/7 background mode
```

**Deployment modes:**

| Mode | Config | Best for |
|:-----|:-------|:---------|
| **Polling** (default) | No extra config | Development, behind NAT |
| **Webhook** | `"webhookUrl": "https://your-domain.com/telegram"` | Production, lower latency |

**Supported message types:** text, images, audio, video, documents, stickers, locations, contacts, inline buttons, reply threads, typing indicators.

**What you can do via Telegram:**

| Category | Capabilities |
|:---------|:-------------|
| **Remote Coding** | Code modifications, bug fixes, refactoring, file analysis, create commits & PRs |
| **Bash Execution** | Run build, test, deploy commands — with confirmation for destructive ops |
| **Rich Media** | Send images → Gemini Vision analysis, send files (code, logs) → processed by agent |
| **Voice Messages** | Send voice notes → STT transcription → agent response |
| **Daemon Mode** | 24/7 background operation (`buddy daemon start`), cron jobs, proactive alerts |
| **Notifications** | Build failures, test results, heartbeat alerts pushed to your Telegram |
| **Interactive** | Inline buttons for confirmations, Markdown-formatted responses |

**Pro features:**

| Feature | Description |
|:--------|:------------|
| **Scoped Authorization** | Tiered permissions: `read-only` → `write-patch` → `run-tests` → `deploy` |
| **Diff-First Mode** | Preview all code changes before applying — Apply / Full Diff / Cancel buttons |
| **Run Tracker** | Step-by-step timeline of agent runs with cost, duration, artifacts |
| **CI Watcher** | GitHub Actions / GitLab CI / Jenkins alerts with "Fix it" auto-agent |
| **Secret Handles** | Map friendly names to env vars — secrets never enter LLM context |
| **Context Pins** | Pin important decisions or facts for the agent to remember |

**Enhanced commands:**

| Command | Description |
|:--------|:------------|
| `/repo` | Repository info, recent commits, open PRs |
| `/branch [name]` | Branch diff stats vs main |
| `/pr [number]` | List or view PRs with merge/review buttons |
| `/task <desc>` | Create an agent task with objective |
| `/runs` | List recent agent runs with timeline |
| `/run <id>` | View run details with Re-run/Tests/Rollback buttons |
| `/yolo [minutes]` | Timed full access (1-60 min, auto-revokes) |
| `/pins` | View pinned context |

**Example workflows:**

Fix CI failure:
```
CI alert arrives → cause analysis → "Fix it" button
→ agent creates fix → diff preview → Apply/Cancel
→ changes applied → tests re-run
```

Add feature + tests + PR:
```
/task "add user search with tests"
→ plan-first preview → approve plan
→ diff-first preview → apply changes
→ agent creates PR → link in chat
```

### DM Pairing (Access Control)

Prevents unauthorized users from consuming API credits:

1. Unknown user messages the bot → receives a **6-character pairing code** (expires in 15 min)
2. Bot owner approves: `/pairing approve telegram ABC123`
3. User is added to the persistent allowlist (`~/.codebuddy/credentials/telegram-allowFrom.json`)

Security features: rate limiting (5 failed attempts → 1h block), per-channel allowlists, admin bypass.

### Other Channels

```typescript
// Discord
const discord = new DiscordChannel({
  token: process.env.DISCORD_TOKEN,
  allowedGuilds: ['guild-id'],
});
await discord.connect();

// WhatsApp (Baileys, QR pairing)
const whatsapp = new WhatsAppChannel({ dataPath: '~/.codebuddy/whatsapp' });
await whatsapp.connect(); // Scan QR code

// Signal (signal-cli REST API)
const signal = new SignalChannel({ apiUrl: 'http://localhost:8080', phoneNumber: '+1234567890' });
await signal.connect();

// Matrix (E2EE, threads)
const matrix = new MatrixChannel({ homeserverUrl: 'https://matrix.org', accessToken: '...' });
await matrix.connect();
```

---

## Autonomous Agent

### Daemon Mode

Run Code Buddy 24/7 in the background:

```bash
buddy daemon start [--detach]  # Start background daemon
buddy daemon stop              # Stop daemon
buddy daemon restart           # Restart daemon
buddy daemon status            # Show daemon status and services
buddy daemon logs [--lines N]  # View daemon logs
```

Features:
- PID file management with stale detection
- Auto-restart on crash (max 3 retries)
- Service registry and health monitoring (CPU, memory)
- **Heartbeat engine** — periodic agent wake with HEARTBEAT.md checklist, smart suppression, active hours

```bash
buddy heartbeat start          # Start the heartbeat engine
buddy heartbeat stop           # Stop the heartbeat engine
buddy heartbeat status         # Show heartbeat status
buddy heartbeat tick           # Manually trigger a single tick
```

### Multi-Agent Orchestration

The **SupervisorAgent** coordinates multiple agent instances:

- **Strategies** — sequential, parallel, race, all
- **Shared context** — thread-safe key-value store with optimistic locking
- **Self-healing** — error pattern recognition (6 built-in patterns), auto-recovery with exponential backoff
- **Checkpoint rollback** — auto-checkpoint before risky ops, rollback to last good state

### YOLO Mode (Autonomous Execution)

Full autonomy with built-in guardrails for safe unattended operation:

```bash
# Enable via CLI
/yolo on           # Enable (50 auto-edits, 100 auto-commands)
/yolo safe         # Restricted mode (20 edits, 30 commands, limited paths)
/yolo off          # Disable
/yolo status       # Show limits, counters, allow/deny lists

# Or via environment
YOLO_MODE=true buddy   # Still requires /yolo on confirmation in chat
```

**What changes in YOLO mode:**

| Setting | Normal | YOLO |
|:--------|:-------|:-----|
| Tool rounds | 50 | 400 |
| Cost limit | $10 | $100 (cap $1,000) |
| File edits | Confirm each | Auto-approve (up to limit) |
| Bash commands | Confirm each | Auto-execute safe commands |

**Autonomy levels** (fine-grained control):

```bash
/autonomy suggest   # Confirm everything
/autonomy confirm   # Confirm important ops (default)
/autonomy auto      # Auto-approve safe ops, confirm dangerous
/autonomy full      # Auto-approve all except critical
/autonomy yolo      # Full auto with guardrails
```

**Customize allow/deny lists:**

```bash
/yolo allow "npm run dev"      # Add to auto-execute list
/yolo deny "docker rm -f"      # Block a command pattern
```

**Built-in guardrails (always active, even in YOLO):**
- Blocked paths: `.env`, `.git`, `node_modules`, `*.pem`, `*.key`, `credentials`
- Blocked commands: `rm -rf /`, `sudo`, `git push --force origin main`, `DROP DATABASE`
- Per-session limits on edits and commands
- Hard cost cap ($1,000 max even with `MAX_COST` override)

### Cron & Scheduling

The **Cron-Agent Bridge** connects the scheduler to CodeBuddyAgent instances for recurring tasks:

```bash
buddy trigger add time:*/30 action:run-tests    # Run tests every 30 min
buddy trigger add webhook:deploy action:notify   # Notify on deploy webhook
```

Webhook triggers use HMAC-SHA256 verification with template placeholders for flexible integration.

---

## AI Providers

Code Buddy supports multiple AI providers with automatic failover:

| Provider | Models | Context | Configuration |
|:---------|:-------|:--------|:--------------|
| **Grok** (xAI) | grok-4, grok-code-fast-1 | 128K | `GROK_API_KEY` |
| **Claude** (Anthropic) | claude-sonnet-4, opus | 200K | `ANTHROPIC_API_KEY` |
| **ChatGPT** (OpenAI) | gpt-4o, gpt-4-turbo | 128K | `OPENAI_API_KEY` |
| **Gemini** (Google) | gemini-2.0-flash (+ vision) | 2M | `GOOGLE_API_KEY` |
| **LM Studio** | Any local model | Varies | `--base-url http://localhost:1234/v1` |
| **Ollama** | llama3, codellama, etc. | Varies | `--base-url http://localhost:11434/v1` |

**Model failover chain** — cascading provider fallback with health tracking and cooldown periods.

### Connection Profiles

```bash
# Use LM Studio (local)
buddy --base-url http://localhost:1234/v1 --api-key lm-studio

# Use Ollama (local)
buddy --base-url http://localhost:11434/v1 --model llama3

# Use a specific model
buddy --model grok-code-fast-1
```

**Profile configuration** in `~/.codebuddy/user-settings.json`:

```json
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

**Auth profile manager** — API key rotation (round-robin/priority/random strategies), session stickiness, exponential backoff on failures.

```bash
buddy auth-profile list                   # List authentication profiles
buddy auth-profile add <id> <provider>    # Add a profile
buddy auth-profile remove <id>            # Remove a profile
buddy auth-profile reset                  # Reset all cooldowns
```

---

## Security & Trust

### Tool Policy & Bash Allowlist

Fine-grained control over what tools the agent can use:

```typescript
// Tool-level allow/deny
const policy = new ToolPolicy({
  allowlist: ['read_file', 'search', 'web_fetch'],
  denylist: ['bash', 'write_file'],
  requireConfirmation: ['delete_file'],
});

// Bash command patterns
const bashPolicy = new BashAllowlist({
  patterns: [/^npm (install|test|run)/, /^git (status|diff|log)/],
  blocked: [/rm -rf/, /sudo/, /curl.*\|.*sh/],
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

### Trust Folders & Agent Profiles

- **Trust folders** — directory-level tool permissions via `.codebuddy-trust.json`
- **Agent profiles** — predefined configs: `secure` (read-only), `minimal`, `power-user`
- **Per-model tool config** — capabilities, context window, and patch format per model family

### Docker Sandbox

Containerized command execution for untrusted operations:

```typescript
const sandbox = new DockerSandbox({
  image: 'codebuddy/sandbox:latest',
  memoryLimit: '512m',
  networkMode: 'none',
  timeout: 30000,
});
```

**Auto-sandbox router** automatically routes dangerous commands (npm, pip, cargo, make) to Docker when available.

### Safety Rails

| Rail | Description |
|:-----|:------------|
| **Diff-First Mode** | All code changes are previewed before applying. Users see file summaries, line counts, and can view the full unified diff. |
| **Plan-First Mode** | Multi-step tasks show the execution plan for approval before any changes are made. |
| **Scoped Permissions** | Users get only the access they need: `read-only` → `write-patch` → `run-tests` → `deploy`. |
| **Audit Trail** | Every tool execution, confirmation, and security decision is logged. |
| **Secret Handles** | API tokens and credentials are referenced by handle name only — actual values are resolved from env vars at runtime, never exposed to the LLM context. |
| **2-Step Confirmation** | Risky operations (rollback, deploy) require double confirmation with a 2-minute timeout window. |
| **Timed YOLO** | `/yolo` grants temporary full access that auto-revokes after the specified duration. |
| **DM Pairing** | Unknown users must be approved before they can interact with the bot. |

---

## Architecture

### Facade Architecture

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

### Autonomy Layer

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

## API Server & Integrations

### REST API

```bash
buddy server --port 3000
```

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
| `/api/heartbeat/status` | GET | Heartbeat engine status |
| `/api/heartbeat/start\|stop\|tick` | POST | Heartbeat control |
| `/api/hub/search?q=...` | GET | Search skills marketplace |
| `/api/hub/installed` | GET | List installed hub skills |
| `/api/hub/install` | POST | Install a skill |
| `/api/hub/{name}` | DELETE | Uninstall a skill |
| `/api/identity` | GET | List loaded identity files |
| `/api/identity/prompt` | GET | Combined identity prompt |
| `/api/identity/{name}` | PUT | Update an identity file |
| `/api/groups/status\|list` | GET | Group security status/config |
| `/api/groups/block` | POST | Block a user globally |
| `/api/groups/block/{userId}` | DELETE | Unblock a user |
| `/api/auth-profiles` | GET/POST/DELETE | Auth profile CRUD |
| `/api/auth-profiles/reset` | POST | Reset all cooldowns |

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

### MCP Servers

Four MCP servers are pre-configured (disabled by default):

```bash
buddy mcp add brave-search    # Brave Web Search (needs BRAVE_API_KEY)
buddy mcp add playwright      # Browser automation (no key needed)
buddy mcp add exa-search      # Exa neural search (needs EXA_API_KEY)
buddy mcp add icm             # Infinite Context Memory (needs `cargo install icm`)
buddy mcp list                # Show all configured servers
```

### Plugin System

Plugins extend Code Buddy with custom tools, commands, and providers:

```
~/.codebuddy/plugins/
  my-plugin/
    manifest.json
    index.js
```

Plugin types: **Tool**, **Provider** (LLM/embedding/search), **Command**, **Hook**

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

### Extensions

Manifest-based extension system with lifecycle hooks and config schema. Extensions live in `.codebuddy/extensions/`.

### Copilot Proxy

IDE-compatible completions backend — serves `/v1/completions` with bearer auth, per-IP rate limiting, and token clamping.

### External Tools (RTK & ICM)

| Tool | Install | Purpose |
|:-----|:--------|:--------|
| **RTK** | `cargo install --git https://github.com/rtk-ai/rtk` | CLI proxy that wraps commands to reduce LLM token usage 60-90% |
| **ICM** | `cargo install --git https://github.com/rtk-ai/icm` | MCP server for persistent cross-session memory |

RTK is automatically integrated via a before-hook — supported bash commands are prefixed with `rtk` transparently. Configure in `.codebuddy/config.toml` under `[integrations]`.

---

## CLI Reference

### Global Options

| Flag | Short | Description | Default |
|:-----|:------|:------------|:--------|
| `--version` | `-V` | Show version number | - |
| `--directory <dir>` | `-d` | Set working directory | `.` |
| `--api-key <key>` | `-k` | API key (or `GROK_API_KEY` env) | - |
| `--base-url <url>` | `-u` | API base URL (or `GROK_BASE_URL` env) | - |
| `--model <model>` | `-m` | AI model to use (or `GROK_MODEL` env) | auto-detect |
| `--prompt <prompt>` | `-p` | Single prompt, headless mode | - |
| `--browser` | `-b` | Launch browser UI instead of terminal | `false` |
| `--max-tool-rounds <n>` | | Max tool execution rounds | `400` |
| `--security-mode <mode>` | `-s` | `suggest`, `auto-edit`, or `full-auto` | `suggest` |
| `--output-format <fmt>` | `-o` | Headless output: `json`, `stream-json`, `text`, `markdown` | `json` |
| `--context <patterns>` | `-c` | Glob patterns to load into context | - |

### Session & Cost

| Flag | Description | Default |
|:-----|:------------|:--------|
| `--continue` | Resume the most recent saved session | - |
| `--resume <id>` | Resume a specific session (supports partial ID matching) | - |
| `--max-price <dollars>` | Maximum cost in dollars before stopping | `10.0` |
| `--no-cache` | Disable response caching | - |

### Autonomy & Permissions

| Flag | Description | Default |
|:-----|:------------|:--------|
| `--auto-approve` | Automatically approve all tool executions | `false` |
| `--dangerously-skip-permissions` | Bypass all permission checks (trusted containers only) | `false` |
| `--no-self-heal` | Disable self-healing auto-correction | - |
| `--allow-outside` | Allow file operations outside workspace directory | `false` |

### Tool Control

| Flag | Description | Example |
|:-----|:------------|:--------|
| `--force-tools` | Force-enable function calling for local models | - |
| `--probe-tools` | Auto-detect tool support at startup | - |
| `--enabled-tools <patterns>` | Only enable matching tools (glob, comma-separated) | `bash,*file*,search` |
| `--disabled-tools <patterns>` | Disable matching tools (glob, comma-separated) | `bash,web_*` |
| `--allowed-tools <patterns>` | Alias for `--enabled-tools` (Claude Code compat) | - |

### Agent & Prompt Configuration

| Flag | Description | Default |
|:-----|:------------|:--------|
| `--system-prompt <id>` | System prompt: `default`, `minimal`, `secure`, `code-reviewer`, `architect` (or custom from `~/.codebuddy/prompts/`) | `default` |
| `--list-prompts` | List available system prompts and exit | - |
| `--agent <name>` | Use a custom agent from `~/.codebuddy/agents/` | - |
| `--list-agents` | List available custom agents and exit | - |

### Display & Debugging

| Flag | Description |
|:-----|:------------|
| `--plain` | Minimal formatting (plain text output) |
| `--no-color` | Disable colored output |
| `--no-emoji` | Disable emoji in output |
| `--vim` | Enable Vim keybindings for input |
| `--mcp-debug` | Enable MCP protocol debugging output |

### Setup & Init

| Flag | Description |
|:-----|:------------|
| `--init` | Initialize `.codebuddy/` directory with templates |
| `--dry-run` | Preview changes without applying (simulation mode) |
| `--setup` | Run interactive API key setup wizard |
| `--list-models` | List available models from the API and exit |

---

## Commands

### Slash Commands (In-Chat)

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
| `/speak <text>` | Speak text with current TTS provider |
| `/tts on\|off\|auto` | TTS control |
| `/yolo on\|off\|safe\|status` | YOLO mode control |
| `/autonomy suggest\|confirm\|auto\|full\|yolo` | Autonomy level |

### CLI Subcommands

```bash
# Daemon
buddy daemon start|stop|restart|status|logs

# Triggers
buddy trigger list|add|remove

# Webhooks
buddy webhook list|add|remove

# Skills Hub
buddy hub search|install|uninstall|update|list|info|publish|sync

# Heartbeat
buddy heartbeat start|stop|status|tick

# Identity
buddy identity show|get|set|prompt

# Groups
buddy groups status|list|block|unblock

# Auth Profiles
buddy auth-profile list|add|remove|reset

# Devices
buddy device list|pair|remove|snap|screenshot|record|run

# Config
buddy config show|validate|get

# Security
buddy security-audit [--deep] [--fix] [--json]

# Voice
buddy speak [text] [--voice <name>] [--list-voices] [--speed <n>] [--format <fmt>]

# Setup
buddy onboard          # Interactive setup wizard
buddy doctor           # Environment diagnostics
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
| `BRAVE_API_KEY` | Brave Search API key | - |
| `EXA_API_KEY` | Exa neural search API key | - |
| `PERPLEXITY_API_KEY` | Perplexity AI search key (`pplx-...`) | - |
| `OPENROUTER_API_KEY` | OpenRouter key for Perplexity (`sk-or-...`) | - |
| `PERPLEXITY_MODEL` | Perplexity model | `perplexity/sonar-pro` |
| `PICOVOICE_ACCESS_KEY` | Porcupine wake word detection | - |
| `CACHE_TRACE` | Debug prompt construction stages | `false` |
| `YOLO_MODE` | Full autonomy | `false` |
| `MAX_COST` | Cost limit ($) | `10` |
| `JWT_SECRET` | API server auth | Required in prod |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token (from @BotFather) | - |
| `DISCORD_TOKEN` | Discord bot token | - |
| `SLACK_BOT_TOKEN` | Slack bot token | - |

**Optional Rust tools:**

| Tool | Install | Purpose |
|:-----|:--------|:--------|
| **RTK** | `cargo install --git https://github.com/rtk-ai/rtk` | CLI proxy that wraps commands to reduce LLM token usage 60-90% |
| **ICM** | `cargo install --git https://github.com/rtk-ai/icm` | MCP server for persistent cross-session memory |

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
23,700+ tests across 554+ suites covering:
- Core: Tool Policy, Bash Allowlist, Context Window Guard, Compaction
- Agent: Middleware Pipeline, Profiles, Reasoning, Streaming
- Autonomy: Daemon, Cron Bridge, Task Planner, Delegation Engine
- Observation: Screen Observer, Triggers, Proactive Notifications
- Orchestration: Supervisor, Shared Context, Self-Healing, Rollback
- Providers: Gemini (vision + conversation), OpenAI-compat, Failover
- Security: Trust Folders, Skill Scanner, Bash Parser, Session Locks
- Infrastructure: MCP Client, Webhooks, Extensions, ACP Protocol, RTK Compressor, ICM Bridge
- Voice: Wake Word, TTS Providers, Voice Control Loop
- UI: ChatHistory, ChatInterface, TabbedQuestion
```

---

## Research & Inspiration

Code Buddy implements techniques from academic research and draws architectural inspiration from leading open-source projects.

### Scientific Papers

**Reasoning & Planning:**

| Paper | Reference | Implementation |
|:------|:----------|:---------------|
| Tree of Thoughts | Yao et al., 2023 — [arXiv:2305.10601](https://arxiv.org/abs/2305.10601) | `src/agent/reasoning/tree-of-thought.ts` |
| RethinkMCTS | Zhang et al., 2024 — [arXiv:2409.09584](https://arxiv.org/abs/2409.09584) | `src/agent/reasoning/mcts.ts` |
| TALE (Token-Budget-Aware Reasoning) | [arXiv:2412.18547](https://arxiv.org/abs/2412.18547) | `src/agent/token-budget-reasoning.ts` — 68.9% token reduction |
| FrugalGPT | Stanford, 2023 — [arXiv:2305.05176](https://arxiv.org/abs/2305.05176) | `src/optimization/model-routing.ts` — 30-70% cost reduction |
| LLMCompiler | [arXiv:2312.04511](https://arxiv.org/abs/2312.04511) | `src/optimization/parallel-executor.ts` — 2.5-4.6x speedup |

**Program Repair:**

| Paper | Reference | Implementation |
|:------|:----------|:---------------|
| ChatRepair | Xia et al., ISSTA 2024 — [arXiv:2403.12538](https://arxiv.org/abs/2403.12538) | `src/agent/repair/iterative-repair.ts` |
| ITER | [arXiv:2403.00418](https://arxiv.org/abs/2403.00418) | `src/agent/repair/repair-templates.ts` — iterative template repair |
| RepairAgent | ICSE 2024 | `src/agent/repair/repair-engine.ts` — autonomous LLM-based repair |
| AgentCoder | Huang et al., 2023 | `src/agent/multi-agent/multi-agent-system.ts` — hierarchical multi-agent code generation |

**RAG & Context Management:**

| Paper | Reference | Implementation |
|:------|:----------|:---------------|
| CodeRAG | [arXiv:2509.16112](https://arxiv.org/abs/2509.16112) | `src/context/multi-path-retrieval.ts`, `src/context/dependency-aware-rag.ts` |
| RAG-MCP | [arXiv:2505.03275](https://arxiv.org/abs/2505.03275) | `src/tools/tool-selector.ts` |
| ToolLLM | ICLR'24 — [arXiv:2307.16789](https://arxiv.org/abs/2307.16789) | `src/agent/execution/tool-selection-strategy.ts` |
| Comprehensive RAG Survey | [arXiv:2506.00054](https://arxiv.org/abs/2506.00054) | `src/context/codebase-rag/codebase-rag.ts` |
| Recurrent Context Compression | [arXiv:2406.06110](https://arxiv.org/abs/2406.06110) | `src/context/context-manager-v2.ts` |

**Observation & Optimization:**

| Paper | Reference | Implementation |
|:------|:----------|:---------------|
| JetBrains Context Management | JetBrains Research, 2024 | `src/context/observation-masking.ts` — -7% cost, +2.6% success |
| Complexity Trap | [arXiv:2508.21433](https://arxiv.org/abs/2508.21433) | `src/context/observation-masking.ts` |
| Less-is-More (Tool Filtering) | arXiv, 2024 | `src/optimization/tool-filtering.ts` — 70% execution time reduction |
| The Prompt Report | [arXiv:2406.06608](https://arxiv.org/abs/2406.06608) | `src/prompts/system-base.ts` |

**Testing & Memory:**

| Paper | Reference | Implementation |
|:------|:----------|:---------------|
| TDD + LLM | ICSE 2024 | `src/testing/tdd-mode.ts` — TDD improves Pass@1 by 45.97% |
| MemGPT | UC Berkeley, 2023 | `src/memory/prospective-memory.ts` — stateful AI agents |

**Fault Localization:** Ochiai, DStar, and Tarantula (Jones et al., 2002) spectrum-based techniques in `src/agent/repair/fault-localization.ts`.

### Inspiration Projects

Code Buddy's architecture draws from these open-source projects:

| Project | Inspiration | Key Files |
|:--------|:------------|:----------|
| **[OpenClaw](https://github.com/openclaw/openclaw)** | Multi-channel messaging, DM pairing, lane queue concurrency, memory lifecycle, tool policy, skills system, heartbeat, identity system, group security, hub marketplace | 40+ files across `src/channels/`, `src/concurrency/`, `src/memory/`, `src/security/`, `src/skills/` |
| **[OpenAI Codex CLI](https://github.com/openai/codex)** | Apply-patch unified diff, head/tail truncation, per-model tool config, turn diff tracker, security modes, sandbox | `src/tools/apply-patch.ts`, `src/utils/head-tail-truncation.ts`, `src/config/model-tools.ts` |
| **[Claude Code](https://github.com/anthropics/claude-code)** | Hook system, slash commands, MCP config, extended thinking, parallel subagents, headless output | `src/hooks/`, `src/commands/slash-commands.ts`, `src/mcp/config.ts`, `src/agent/subagents.ts` |
| **[Gemini CLI](https://github.com/google-gemini/gemini-cli)** | Persistent checkpoints, context files, compress command, shell prefix, multimodal input | `src/checkpoints/`, `src/context/context-files.ts`, `src/input/multimodal-input.ts` |
| **[Aider](https://github.com/paul-gauthier/aider)** | Repository map, voice input, unified diff editor, watch mode (IDE comments) | `src/context/repository-map.ts`, `src/tools/voice-input.ts`, `src/commands/watch-mode.ts` |
| **[Cursor](https://www.cursor.com/)** | `.cursorrules` config, parallel agent system, sandboxed terminals, embedded browser | `src/config/codebuddyrules.ts`, `src/agent/parallel/`, `src/browser/embedded-browser.ts` |
| **[Mistral Vibe](https://github.com/mistralai/mistral-vibe)** | External markdown prompts, TOML config, tool permission system, fuzzy match, update notifier | `src/prompts/`, `src/config/toml-config.ts`, `src/utils/fuzzy-match.ts` |
| **[Conductor](https://github.com/conductor-is/conductor)** | Spec-driven development, track system | `src/tracks/` |
| **[RTK](https://github.com/rtk-ai/rtk)** | Command proxy for 60-90% token reduction | `src/utils/rtk-compressor.ts` |
| **[ICM](https://github.com/rtk-ai/icm)** | Persistent cross-session memory via MCP | `src/memory/icm-bridge.ts` |

**Other influences:** Rust (Result<T, E> pattern), AutoGPT, MetaGPT, CrewAI, ChatDev (role-based multi-agent), ReAct (reasoning + acting paradigm), Qodo/PR-Agent (RAG for code repos).

**Benchmarks referenced:** SWE-bench, HumanEval, MBPP, BigCodeBench, WebArena, Berkeley Function Calling Leaderboard.

For detailed research notes, see `docs/RESEARCH_IMPROVEMENTS.md`, `docs/RAG_TOOL_SELECTION.md`, and `deep_research/ai-coding-assistant-improvements/`.

---

## Troubleshooting

**API key not working**
```bash
echo $GROK_API_KEY  # Verify key is set
buddy --prompt "test"
```

**Switching providers doesn't work**
```bash
# Verify connection to local model
buddy --base-url http://localhost:1234/v1 --api-key lm-studio --prompt "test"

# List available models
buddy --list-models
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
- Use local LLM: `buddy --base-url http://localhost:11434/v1 --model llama3`

**Debug mode**
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

<sub>Multi-AI: Grok | Claude | ChatGPT | Gemini | LM Studio | Ollama</sub>

</div>
