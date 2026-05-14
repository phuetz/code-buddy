# Getting Started

## Prerequisites

- **Node.js** 18.0.0 or higher
- **ripgrep** (recommended for faster search)
- **Docker** (optional, required for CodeAct/sandbox execution)

```bash
# macOS
brew install ripgrep

# Ubuntu/Debian
sudo apt-get install ripgrep

# Windows
choco install ripgrep
```

## Installation

```bash
# npm (recommended)
npm install -g @phuetz/code-buddy

# Or try without installing
npx @phuetz/code-buddy@latest

# From source
git clone https://github.com/phuetz/code-buddy.git
cd code-buddy
npm install
npm run build
npm start
```

## First Run

```bash
# Set your API key (Grok/xAI is the default provider)
export GROK_API_KEY=your_api_key

# Start interactive mode
buddy

# Or with a specific task
buddy --prompt "analyze the codebase structure"

# Use a local LLM (LM Studio)
buddy --base-url http://localhost:1234/v1 --api-key lm-studio

# Use Ollama
buddy --base-url http://localhost:11434/v1 --model llama3

# Full autonomy mode
buddy --yolo
```

Code Buddy auto-detects your provider from the API key environment variables. Set any of `GROK_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, `MISTRAL_API_KEY`, etc.

## Headless Mode (CI / Scripting)

```bash
# Single prompt, JSON output to stdout
buddy -p "create a hello world Express app" --output-format json > result.json

# Pipe into other tools
buddy -p "explain this code" --output-format json 2>/dev/null | jq '.content'

# CI with full autonomy
buddy -p "run tests and fix failures" \
  --dangerously-skip-permissions \
  --output-format json \
  --max-tool-rounds 30

# Auto-approve all tool executions
buddy -p "fix lint errors" --auto-approve --output-format text
```

Headless mode exits cleanly after completion -- safe for `timeout`, shell scripts, and CI pipelines.

## Session Management

```bash
# Continue the most recent session
buddy --continue

# Resume a specific session by ID (supports partial matching)
buddy --resume abc123

# Set a cost limit for the session
buddy --max-price 5.00
```

## Typical Workflow

```bash
# 1. First-time setup
buddy --setup                # Quick API key setup wizard
buddy onboard                # Full interactive config wizard
buddy doctor                 # Verify environment and dependencies
buddy --init                 # Scaffold .codebuddy/ + AGENTS.md in current project

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
buddy speak                     # Voice conversation mode
buddy daemon start              # Run 24/7 in background
buddy server --port 3000        # Expose REST/WebSocket API
```

Code Buddy autonomously reads files, writes code, runs commands, and fixes errors -- typically 5-15 tool calls per task (up to 50, or 400 in YOLO mode). After each edit, it can auto-commit (Aider-style), run linters, and execute tests automatically.

## Auto-memory

When `memoryEnabled` is on (default), the agent **proactively persists** facts it learns about you and your project to `.codebuddy/CODEBUDDY_MEMORY.md` (project-scoped) and `~/.codebuddy/memory.md` (user-scoped, all projects). No `/memory remember` typing required — the LLM is instructed to call the `remember` tool whenever it learns something non-obvious.

Examples of what gets auto-persisted:
- "User prefers single quotes in JS"
- "This project uses Vitest, not Jest"
- "Build with `npm run build:gui` for the Electron app"
- Architectural decisions, gotchas, conventions you reveal in conversation

To inspect what's been persisted:
```
> /memory recent              # Last 10 entries with relative timestamps
> /memory recent 5 user       # Top 5 entries scoped to user-level
> /memory forget <key>        # Remove an entry (when noise creeps in)
> /status                     # See counts + last update at-a-glance
```

Same UX pattern as Claude Code's auto-managed `MEMORY.md`. The agent re-reads these files into the system prompt at the start of every session, so what it learned yesterday stays available today. Edit the markdown by hand any time — Code Buddy parses it on next launch.

## Talking to other Claudes (Fleet)

Code Buddy can connect to other Code Buddy instances over your network so multiple agents can share events live and invoke each other's LLMs. This is the **Fleet Hub** (Phases (d).1 → (d).16a, May 2026).

### 30-second quickstart

On the **listener** instance (the one that wants to be observable):
```bash
buddy server --port 3000          # Start the local Gateway WS
```

On the **peer** instance (the one connecting):
```bash
buddy
> /fleet listen ws://other-host:3000 --api-key <fleet:listen-scoped-key>
```

You're now streaming the peer's `fleet:agent:tool_started`, `fleet:workflow:event`, `fleet:session:message` events live in your own session.

To send a message to the peer (and have it route to its LLM):
```
> /fleet send peer.chat "hello, can you analyze this file?"
```

Inspect connection state:
```
> /fleet status               # Current peer URL, connection state, recent events
> /fleet stop                 # Disconnect cleanly
```

### Two stated objectives

The fleet hub serves two complementary goals (per the design doc):
1. **Real-time inter-AI collaboration** — multiple Claudes / Geminis observing the same project, exchanging messages
2. **Pilot local LLMs from any peer** — Ollama on one node, prompted from another (free coding/reasoning over your Tailscale network)

### Local swarm (no peers needed)

If you don't want to set up multiple peers but want the team-lead pattern, use the local Multi-Agent System:
```
> /swarm refactor the auth module to use JWT with PKCE
```
This auto-enables `MultiAgentSystem`, decomposes the task, and dispatches subtasks to specialized worker agents (orchestrator, coder, reviewer, tester) running concurrently. Inspired by Korben's article on Claude Code's hidden Swarms mode — but Code Buddy ships the infrastructure built-in (no patch needed). Track with `/swarm status`, stop with `/swarm stop`.

### Full guide

See [`docs/fleet-guide.md`](fleet-guide.md) for: provider auto-detection (Ollama priority), all peer-rpc methods, env vars (`CODEBUDDY_FLEET_*`), Tailscale lab examples, security model, hub-vs-spoke topology, and the V1.x roadmap.

## Troubleshooting

### "API key required" or "401 Unauthorized" at startup
Most providers need an env var **and** the matching base URL. Common pairs:
- Grok / xAI: `export GROK_API_KEY=...` (default base URL works)
- Anthropic: `export ANTHROPIC_API_KEY=...`
- Google Gemini: `export GOOGLE_API_KEY=...` or `GEMINI_API_KEY=...`
- OpenAI: `export OPENAI_API_KEY=...`
- Ollama (local): no key needed, but pass `--base-url http://localhost:11434/v1 --model llama3`

Run `buddy doctor` to verify which keys are detected. Check the active provider mid-session with `/status`.

### "Cannot find module" or ESM import errors
Code Buddy is ESM-only. From source, ensure Node.js ≥ 18.0.0 and that you ran `npm install && npm run build` in the project root. Imports of `.ts` files need a `.js` extension at the import site (the build handles this for you).

### Slow startup (> 5s) or noticeable cold-start cost
Set `PERF_TIMING=true` to see which lazy-loaded modules dominate startup. Most heavy features (voice, browser automation, desktop) are loaded on-demand only when first invoked, so a vanilla `buddy` should warm up in 1-2 seconds.

### "Lock file exists" / stale session
```bash
buddy doctor --fix          # Auto-removes stale lock files in .codebuddy/
```

### Permission prompts on every tool call
Switch to a more autonomous mode:
```bash
buddy --permission-mode acceptEdits   # Auto-approve safe edits
buddy --yolo                          # Full autonomy (use with care, $100 cap)
```
Or use `/yolo on` mid-session.

### Memory not persisting across sessions
Confirm `.codebuddy/CODEBUDDY_MEMORY.md` exists in your project. If not, run `buddy --init`. Then run `/memory recent` to confirm the agent is actually persisting (auto-memory shipped in 1.0.0-rc.2). If `/memory recent` shows "never", make sure `memoryEnabled` is on in your config (default).

### Fleet: "AUTH_FAILED" when connecting to a peer
The peer's API key needs the `fleet:listen` scope. On the peer, regenerate with:
```
buddy api-key create --name "Fleet peer" --scope fleet:listen --scope peer:invoke
```
Then pass the new key with `--api-key` to `/fleet listen` on the connecting instance.
The command stores only a hash in `~/.codebuddy/server-api-keys.json`, and the
running server reloads the store when it changes.

### Fleet: connection drops repeatedly
Auto-reconnect is opt-in (`autoReconnect: true` in the listener options). Without it, a single drop ends the session. With it, the listener uses exponential backoff. Check `/fleet status` for the current state. Persistent drops usually indicate an apiKey scope issue or a network/firewall problem (Tailscale ACLs, port 3000 reachable?).

### Cannot find ripgrep / search is slow
Install ripgrep (see Prerequisites). Without it, Code Buddy falls back to a slower Node-based search.

### Stream errors mid-response (ECONNRESET, "socket hang up")
Enable opt-in stream retry:
```bash
export CODEBUDDY_STREAM_RETRY=1     # Exponential backoff, 4 attempts max
buddy
```
Trade-off: a retried stream restarts from the beginning, so you may see duplicated content across the retry boundary. Default-off in 1.0.0-rc.2 pending observation; will become default-on in 1.0.0 final after a week of clean opt-in usage.

### More
- `buddy doctor` — full environment check
- [`docs/fleet-guide.md`](fleet-guide.md) — Fleet-specific issues and architecture
- [`CHANGELOG.md`](../CHANGELOG.md) — what changed when
- [GitHub Issues](https://github.com/phuetz/code-buddy/issues) — known problems
