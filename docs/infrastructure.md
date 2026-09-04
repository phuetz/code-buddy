# Infrastructure

## HTTP Server

Start the server:

```bash
buddy server --port 3000
```

Default: port 3000, CORS enabled, rate-limit 100 req/min, JWT auth required in production (`JWT_SECRET`).

### Key Endpoints

| Endpoint | Method | Description |
|:---------|:-------|:------------|
| `/api/health` | GET | Health check |
| `/api/metrics` | GET | Prometheus metrics |
| `/api/chat` | POST | Chat completion |
| `/api/chat/completions` | POST | OpenAI-compatible completions |
| `/api/sessions` | GET/POST | Session management |
| `/api/memory` | GET/POST | Memory entries |
| `/api/tools` | GET | List available tools |
| `/api/tools/{name}/execute` | POST | Execute a tool |
| `/api/daemon/status` | GET | Daemon status (`?format=report` for Cowork-ready JSON) |
| `/api/heartbeat/status` | GET | Heartbeat status (`?format=report` includes config and recommendations) |
| `/api/cron/jobs` | GET/POST | Cron job management; loads persisted jobs before listing |
| `/api/hub/search` | GET | Search skills marketplace |
| `/api/hub/installed` | GET | List installed skills |
| `/api/identity` | GET | List identity files |
| `/api/groups/status` | GET | Group security status |
| `/api/auth-profiles` | GET/POST/DELETE | Auth profile CRUD |
| `/__codebuddy__/canvas/:id` | GET | Canvas content serving |
| `/__codebuddy__/a2ui/` | GET | A2UI host page |

### WebSocket Events

```javascript
const ws = new WebSocket('ws://localhost:3000/ws');
ws.send(JSON.stringify({ type: 'authenticate', payload: { token: 'jwt' } }));
ws.send(JSON.stringify({ type: 'chat_stream', payload: { messages: [...] } }));
```

Events: `authenticate`, `chat_stream`, `tool_execute`, `ping/pong`.

### ACPX Sessions

Advanced session management:
- Prompt queue with 202 status and `queuePosition`
- Cancel: `POST /sessions/:name/cancel`
- Soft-close: `POST /sessions/:name/close`
- `resumeSessionId` for session continuation
- `fireAndForget` mode

## WebSocket Gateway

**No second port.** `buddy server` opens a single listener (default `3000`) and
serves the WebSocket on `/ws` of that same port — verified with `ss -ltnp` on a
running server. The multi-client handshake below is the `src/gateway/` library
(`DEFAULT_GATEWAY_CONFIG`), which `buddy server` does **not** instantiate; a
fleet gateway on another port is a *second process* of the same binary
(`docs/deployment.md`).

```
Client -> connect (deviceId, role, protocolVersion)
Server -> hello_ok (paired, uptime, stateVersion, presence[], health, authRequired)
Client -> auth (token or password)
Server -> auth_success
Client -> chat / session_create / session_join / session_patch / presence
```

- **Auth modes**: `token` (JWT), `password`, `none`
- **Bind modes**: `loopback` (127.0.0.1), `all` (0.0.0.0), `tailscale`
- **TLS support**: `tlsEnabled`, `tlsCert`, `tlsKey`, `tlsCa`, `skipLocalPairing`
- **Security**: GHSA-5wcw-8jjv-m286 fix, default `corsOrigins` localhost-only, `trustedProxies` config
- **Origin, the two surfaces — they do NOT behave the same.** The WebSocket
  refuses server-side: an unlisted `Origin` is turned away at the handshake with
  `403 Forbidden origin` (a client sending no `Origin` at all — CLI, fleet peer —
  is let through). HTTP does not refuse: an unlisted origin gets a normal `200`
  with the body, only **without** the `Access-Control-Allow-Origin` header, so
  the *browser* blocks the read. CORS is therefore not an access control; use the
  JWT and the network for that.
- Device identity with challenge nonce verification
- Presence tracking (online/offline/away/typing)

## Daemon Mode

Run Code Buddy 24/7 in the background:

```bash
buddy daemon start [--detach]         # Start background daemon
buddy daemon start --install-daemon   # Install as OS service
buddy daemon stop                     # Stop daemon
buddy daemon restart                  # Restart
buddy daemon status                   # Show status
buddy daemon logs [--lines N]         # View logs
```

Features:
- PID file management with stale detection
- Auto-restart on crash (max 3 retries)
- **Heartbeat engine**: periodic agent wake with HEARTBEAT.md checklist, smart suppression, active hours
- **Daily session reset**: automatic context boundary at configurable time (default 04:00)
- **Session maintenance**: auto-prune, rotate, cap max entries
- **Cross-platform service installer**: launchd (macOS), systemd (Linux), Task Scheduler (Windows)

## Cron and Scheduling

```bash
buddy trigger add time:*/30 action:run-tests    # Run tests every 30 min
buddy trigger add webhook:deploy action:notify   # Notify on deploy webhook
```

Session binding: `sessionTarget: 'current'|'new'|<id>` binds cron jobs to specific sessions.

Webhook triggers use HMAC-SHA256 verification with template placeholders.

## Cloud Background Agents

Cloud-based agents run scheduled tasks via event triggers. Configurable per-provider and per-channel.

## Device Nodes

Companion app management for mobile/remote devices:

```bash
buddy nodes list              # List connected devices
buddy nodes pair              # Start pairing (short codes)
buddy nodes approve <code>    # Approve a device
buddy nodes invoke <id> <cap> # Remote invocation
```

Platform capability maps (20+ capabilities): camera, location, clipboard, notifications, and more.

## Canvas and A2UI

- **Canvas**: Push arbitrary content (HTML, Markdown, JSON, SVGs) to `/__codebuddy__/canvas/:id`
- **A2UI**: Agent-generated UI components at `/__codebuddy__/a2ui/`
- **Eval endpoint**: `POST /__codebuddy__/a2ui/eval` for dynamic content

## Cloud Deployment

Generate deployment configs for 6 platforms:

```bash
buddy deploy platforms        # List supported platforms
buddy deploy init             # Generate deployment config
buddy deploy nix              # Generate Nix flake
```

Supported: Fly.io, Railway, Render, Hetzner, Northflank, GCP.

## MCP Servers

Pre-configured MCP servers (disabled by default):

```bash
buddy mcp add brave-search    # Brave Web Search
buddy mcp add playwright      # Browser automation
buddy mcp add exa-search      # Exa neural search
buddy mcp add icm             # Infinite Context Memory
buddy mcp list                # Show configured servers
```

MCP OAuth support: Authorization Code + PKCE, local callback server, AES-256-GCM token storage, auto-refresh.

## Plugin System

Plugins extend Code Buddy with tools, commands, providers, and hooks:

```
~/.codebuddy/plugins/my-plugin/
  manifest.json
  index.js
```

Worker thread isolation via `isolated-plugin-runner.ts` with conflict detection. Plugin types: Tool, Provider (LLM/embedding/search), Command, Hook.

## Observability

- **RunStore**: JSONL per run in `.codebuddy/runs/`, 30-run auto-prune
- **OpenTelemetry**: via `OTEL_EXPORTER_OTLP_ENDPOINT`
- **Sentry**: via `SENTRY_DSN`
- **Telemetry toggle**: `/telemetry on|off|errors-only`
- **Per-message display**: `[tokens: X in / Y out | cost: $Z]` after each response
- **Prompt cache stats**: tracks OpenAI/xAI cached_tokens and hit ratio

## Desktop App (Open Cowork Integration)

Code Buddy can be used as the backend for [Open Cowork](https://github.com/phuetz/open-cowork), an Electron desktop app providing:

- **GUI interface** — React + Tailwind chat UI replacing the terminal TUI
- **Sandbox VM** — WSL2 (Windows) / Lima (macOS) isolation
- **GUI automation** — control desktop apps via screenshots + clicks
- **Document generation** — PPTX, DOCX, XLSX via Skills system
- **MCP connectors** — browser, Notion, and custom app integration

### Setup

1. Install Open Cowork from [releases](https://github.com/phuetz/open-cowork/releases)
2. Start Code Buddy server: `buddy --server`
3. In Open Cowork settings, enable Code Buddy backend:
   - Endpoint: `http://localhost:3000`
   - The desktop app routes all LLM calls through Code Buddy's 110+ tools

### Architecture

```
Open Cowork (Electron GUI)
    │
    ├─ HTTP POST /api/chat/completions ──→ Code Buddy Server
    │                                       ├─ 15 LLM providers
    │                                       ├─ 110+ tools + RAG selection
    │                                       ├─ MCTSr reasoning
    │                                       └─ TurboQuant local inference
    │
    └─ MCP servers (shared) ──→ Browser, Notion, etc.
```
