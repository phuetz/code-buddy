# Fleet Guide — Multi-AI hub for real-time inter-AI collaboration

> *« Le but est que toutes mes IA collaborent dans l'harmonie. »*
> — Patrice Huetz, 2026-05-03

This guide covers Code Buddy's **fleet inter-Claude** subsystem
(Phases (d).1 → (d).16a, May 2026). The fleet turns Code Buddy from a
single-instance terminal agent into a **hub of communication between
multiple AIs running on different hosts**, each potentially backed by
a different LLM provider.

---

## Two objectives the fleet was built to serve

### Objective 1 — Real-time inter-AI collaboration

Multiple AI runtimes (Claude Code, Code Buddy, Antigravity, Codex,
gemini-cli) running on different machines should be able to **observe
each other's work in real time** and **call each other** to delegate
work or ask questions. Not just an HTTP API — a stateful, low-latency
mesh where one AI can subscribe to another's events, react, and
respond.

**Today this is operational** for any pair of Code Buddy instances
connected via WebSocket (typically over a Tailscale mesh on the lab):
- A peer's events (tool starts, workflow lifecycle, sub-agent spawns)
  stream live to subscribers
- A peer's LLM can be invoked synchronously via `peer.chat`
- Presence beacons + compaction notices keep peers aware of each
  other's availability

### Objective 2 — Pilot local LLMs for coding (and more)

Cloud LLM quotas are limited and expensive. Local LLMs (Ollama, LM
Studio, vLLM) are free and unlimited, but their tooling is rough.
Code Buddy's **fleet auto-detects an Ollama instance via `OLLAMA_HOST`
in priority over cloud providers**, so a peer with a local Ollama
serves as the LLM endpoint of choice — for coding tasks, reasoning,
classification, anything you'd otherwise pay tokens for.

**Today this is operational**: set `OLLAMA_HOST=http://localhost:11434`
on a peer, start its `buddy server`, and any other peer can
`/fleet send <peer-with-ollama> peer.chat {"prompt":"..."}` to get a
**free, local response**. Mix and match: heavy reasoning on a Claude
Max peer, code drafting on a local Qwen via Ollama, vision on a
Gemini peer, all from the same fleet topology.

---

## Architecture

```
                     ┌──────────────────────────┐
                     │  Hub (any Code Buddy)    │
                     │  buddy server --port N   │
                     │  ws://host:N/ws          │
                     │  /api/health, /api/chat  │
                     └────────────┬─────────────┘
                                  │
              ┌───────────────────┼───────────────────┐
              │                   │                   │
              ▼                   ▼                   ▼
   ┌────────────────┐   ┌────────────────┐   ┌────────────────┐
   │ Peer A         │   │ Peer B         │   │ Peer C         │
   │ /fleet listen  │   │ /fleet listen  │   │ /fleet listen  │
   │ /fleet send    │   │ /fleet send    │   │ /fleet send    │
   └────────────────┘   └────────────────┘   └────────────────┘
   Code Buddy +         Code Buddy +         Code Buddy +
   Claude Max           Antigravity          Ollama qwen3.6
   (peer.chat→Claude)   (peer.chat→Gemini)   (peer.chat→Ollama)
```

The "hub" is just another Code Buddy server — there's no special hub
role. Any peer can host other peers' listen connections. In Patrice's
lab the convention is: **Ministar Linux** (`100.98.18.76:3000`) is
the always-on hub, **MINISTAR G7 PT** + **DARKSTAR PC 3090** are
intermittent peers that connect when active.

Topology is **star, not mesh** — simpler than DHT/gossip. A peer
talks to one or more hubs; hubs don't talk to each other (yet).

---

## Slash commands

All `/fleet` actions live in a single handler
(`src/commands/handlers/fleet-handler.ts`). The active listeners are
held in a `Map<peerId, ActiveListener>` (Phase (d).12 multi-peer
fan-in), so a single Code Buddy can monitor + invoke N peers at once.

### `/fleet listen <ws-url> [options]`

Connect to a peer Code Buddy's WebSocket and subscribe to its
`fleet:*` events.

```bash
/fleet listen ws://100.98.18.76:3000/ws \
  --api-key cb_sk_xxx \
  --auto-reconnect \
  --max-attempts 5 \
  --name ministar-linux
```

Options:
- `--api-key <key>` — required. Override per-call; otherwise pulled
  from `CODEBUDDY_FLEET_API_KEY` env. The key on the **peer's** side
  must hold the `fleet:listen` scope.
- `--name <id>` — stable peer id used by `/fleet stop`, `/fleet send`,
  `/fleet history --peer`. Default = host:port of the WS URL with
  dots → dashes (`100.98.18.76:3000` → `100-98-18-76:3000`).
- `--auto-reconnect` — opt in to exponential-backoff reconnect on ws
  drops (Phase (d).6, uses the shared `ReconnectionManager`).
- `--max-attempts <n>` — cap for `--auto-reconnect` (default 5).

The streaming output to your terminal is prefixed with the peer id
+ source identifier:
```
  [fleet:ministar-linux ministar-ubuntu:abc12345] fleet:agent:tool_started
  [fleet:darkstar darkstar:def67890] fleet:workflow:start
```

### `/fleet send <peer> <method> [json-params] [--timeout <ms>]`

Invoke a `peer.*` RPC method on a connected peer and print the
response.

```bash
/fleet send ministar-linux peer.ping
# → Peer "ministar-linux" → peer.ping OK (12ms): { "pong": true, ... }

/fleet send ministar-linux peer.chat \
  {"prompt":"Explain CEM-MPC briefly","model":"gemini-2.5-flash"}
# → Peer "ministar-linux" → peer.chat OK (2300ms):
#   { "text": "CEM-MPC is...", "modelRequested":"gemini-2.5-flash", ... }

/fleet send (default) peer.chat {"prompt":"..."} --timeout 60000
# → Default peer (when only one is connected); 60s timeout instead of 30s
```

JSON params must be a JSON object (not an array, not a primitive).
Default timeout 30s. `--timeout` overrides per call.

### `/fleet status`

```
Fleet listeners — 2 active

Peer "ministar-linux"
  URL:     ws://100.98.18.76:3000/ws
  Uptime:  127s
  Events:  18 received
  Reconnect: enabled (0/5 attempts since last connect)
  Last seen: 12s ago (heartbeat)
  Last compaction: hybrid in 1234ms (saved 12000 tokens)

Peer "darkstar"
  URL:     ws://100.73.222.64:3000/ws
  Uptime:  93s
  Events:  4 received
  Reconnect: enabled (0/5 attempts since last connect)
  ⚠ stale (>90s) — Last seen: 124s ago (fleet:agent:tool_started)

Stop a peer with /fleet stop <name>, or all with /fleet stop --all.
```

`⚠ stale` triggers when no event has been received from a peer in
the last 90 seconds (configurable via the `STALE_THRESHOLD_MS` const
in fleet-handler.ts). Auto-reconnect kicks in if the WS dropped, but
a peer that's silently hung (handler stuck, GPU timeout) shows up as
stale here.

### `/fleet stop [name|--all]`

```bash
/fleet stop ministar-linux    # disconnect that peer
/fleet stop                   # only valid when 1 peer active
/fleet stop --all             # disconnect every peer
```

### `/fleet history [N] [--peer <name>]`

Show the last N `fleet:*` events received from a peer (default 20,
capped at the listener's ring capacity, default 50).

```bash
/fleet history --peer ministar-linux
# → [22:14:03] fleet:agent:tool_started [ministar-ubuntu] tool=view_file
#   [22:14:05] fleet:agent:tool_completed [ministar-ubuntu] tool=view_file
#   [22:14:08] fleet:peer:heartbeat [ministar-ubuntu] (heartbeat)
#   ...

/fleet history 5 --peer darkstar     # last 5 events from darkstar
```

The history is **in-memory** per listener — kill the session, the
history dies. For persistent audit, broadcast events go to the
underlying WS surface anyway and can be logged elsewhere.

---

## peer-rpc methods

Methods live in `src/server/websocket/peer-rpc.ts` (registry) and
modules under `src/fleet/` register their methods at boot via
`registerPeerMethod(name, handler)`.

### Built-in methods (always available)

#### `peer.describe`
Returns the peer's identity + method catalogue + provider info:
```json
{
  "hostname": "ministar-ubuntu",
  "pid": 4823,
  "methods": ["peer.describe", "peer.ping", "peer.echo", "peer.chat"],
  "apiVersion": "d.16",
  "role": "main",
  "maxDepth": 3,
  "peerChatProvider": {
    "provider": "gemini",
    "model": "gemini-2.5-flash",
    "isLocal": false
  }
}
```

`peerChatProvider` is null when no LLM client is wired (the peer
hasn't set any provider env var). Probe before sending.

#### `peer.ping`
```json
{ "pong": true, "serverTime": 1714670345123 }
```

Use for round-trip latency measurement and connectivity smoke tests.

#### `peer.dispatch` / `peer.dispatchStatus` / `peer.dispatchClear`

Fire-and-forget task execution used by Cowork sagas. `peer.dispatch`
returns immediately with a `runId`; the caller polls
`peer.dispatchStatus` until the task is terminal, persists the result,
then calls `peer.dispatchClear` to remove the peer's in-memory cache
entry.

```json
// Request
{ "prompt": "Review this plan", "model": "qwen3:4b" }

// peer.dispatch response
{ "runId": "disp_abc123", "acceptedAt": 1714670345123 }

// peer.dispatchStatus terminal response
{
  "found": true,
  "runId": "disp_abc123",
  "status": "completed",
  "result": "Looks good...",
  "traceId": "trace-..."
}

// peer.dispatchClear response
{ "runId": "disp_abc123", "cleared": true }
```

#### `peer.echo`
```json
// Request: { "prompt": "...", "n": 42 }
// Response:
{ "echoed": { "prompt": "...", "n": 42 } }
```

Debug method: returns params verbatim. Useful for testing the
request/response loop end-to-end.

### Business methods (registered when wired)

#### `peer.chat` — Phase (d).15

One-shot LLM call on the peer's wired client. No tools, no history
mutation (mirror of the local `/btw` slash pattern).

Request:
```json
{
  "prompt": "What's the time complexity of CEM-MPC?",   // required
  "systemPrompt": "Answer briefly. No tools.",          // optional, default sensible
  "model": "gemini-2.5-flash"                           // optional, override the wired default
}
```

Response:
```json
{
  "text": "CEM-MPC has...",
  "modelRequested": "gemini-2.5-flash",
  "finishReason": "stop",
  "usage": {
    "prompt_tokens": 38,
    "completion_tokens": 142,
    "total_tokens": 180
  },
  "traceId": "trace-1g2h3i4j-5k6l7m8n"
}
```

Errors as Error with `code`:
- `peer.chat: prompt is required` → caller bug (missing/empty prompt)
- `CLIENT_UNAVAILABLE: no LLM client wired on this peer` → peer didn't
  set any provider env var (check `peer.describe.peerChatProvider`)
- `peer.invoke METHOD_ERROR: <upstream message>` → the peer's LLM call
  failed (rate-limited, timeout, model error)
- `peer.invoke REQUEST_TIMEOUT: peer.chat did not respond within 30000ms`
- `peer.invoke MAX_DEPTH_EXCEEDED: depth N > max 3` → call chain too
  deep (Phase (d).14 anti-loop guard)
- `peer.invoke ROLE_LEAF: this peer is configured as leaf` →
  `CODEBUDDY_PEER_ROLE=leaf` on this peer refuses outgoing invokes

#### `peer.tool.invoke` + `peer.tool.invoke.stream` — Phase (d).23 / V1.3

Read-only remote tool invocation. Lets a peer execute a tightly-scoped
set of read tools on THIS peer's filesystem — like a logged, gated
"ssh remote read" baked into the mesh. **V1 is intentionally narrow**
(read-only, allowlist of 3 tools, mandatory workspace root). Future
phases extend to mutating tools with explicit per-call approval.

Request:
```json
{
  "tool": "view_file",                                  // required, must be in allowlist
  "args": { "file_path": "world-model/README.md" }      // tool-specific args
}
```

Response:
```json
{
  "tool": "view_file",
  "output": "# World Model JEPA\n...",
  "durationMs": 18,
  "truncated": false
}
```

Streaming variant `peer.tool.invoke.stream` accepts the same params
and pushes `peer:chunk` frames as the output is produced (16 KB chunks
for `view_file`, line-by-line for `search`). Use
`FleetListener.invokeToolStream(toolName, args, onChunk)` on the caller.

**V1 allowlist** (read-only):
- `view_file` — bounded `fs.open`/`read` of a file under the workspace
  root, 10 MB cap. Args: `{ file_path: string }` (relative to root or
  absolute inside it). Streamed chunks of 16 KB when via `.stream`.
- `list_directory` — bounded `fs.opendir` listing with type tags (`DIR`,
  `FILE`, `LINK`), capped at 500 entries. Args: `{ path: string }`.
- `search` — ripgrep (`@vscode/ripgrep`) text search, capped at 200
  matches and 30 s. Args: `{ query: string, path: string }`. Streamed
  match-by-match when via `.stream`.

**Three security gates** run on every invocation, in this order:

1. **Allowlist** — `tool ∈ {view_file, list_directory, search}`,
   override via `CODEBUDDY_PEER_TOOL_ALLOWLIST=tool1,tool2,...`.
2. **`fleetSafe` registry flag** — `getToolRegistry().isFleetSafe(name)`
   must return `true`. The same flag the A2A executor consults; opt-in
   per `src/tools/metadata.ts`.
3. **Workspace root** — every path argument is resolved + symlink-realpath'd
   and checked against `CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT`. **If the
   env is unset, every invocation fails with `PEER_WORKSPACE_NOT_CONFIGURED`**
   (fail-closed). A misconfigured peer cannot accidentally expose `/`.

Depth cap (`CODEBUDDY_PEER_MAX_DEPTH`) and role-leaf are inherited from
the dispatcher — no extra config needed.

Errors as Error with `code` `METHOD_ERROR` and the bridge code in
`message`:
- `TOOL_NOT_ALLOWED_FOR_PEER_INVOKE: tool "<name>" is not in the peer-invoke allowlist`
- `TOOL_NOT_FLEET_SAFE: tool "<name>" lacks fleetSafe metadata`
- `PEER_WORKSPACE_NOT_CONFIGURED: set CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT...`
- `PATH_OUTSIDE_PEER_WORKSPACE: <p> resolves to <abs>, outside <root>`
- `UNKNOWN_PEER_TOOL: no executor registered for "<name>"`
- `SEARCH_TIMEOUT: ripgrep did not finish within 30000ms`
- `SEARCH_FAILED: ripgrep exited with code <n>: <stderr>`
- `peer.tool.invoke.stream: this transport does not support streaming`
  (only `.stream` requires `ctx.emitChunk`)

Audit log: every invocation produces a structured `logger.info` entry
with shape `{ event, from, traceId, depth, tool, stream, ok, error?, durationMs }`
under message `[fleet] peer.tool.invoke`.

Concrete cross-host call from Cowork or `buddy` CLI:
```bash
> /fleet send darkstar peer.tool.invoke {"tool":"view_file","args":{"file_path":"world-model/README.md"}}
```

Or programmatically from a peer agent:
```ts
const { output } = await listener.invokeTool('view_file', {
  file_path: 'world-model/README.md',
});
```

Required peer config (env on the EXPOSING side):
```bash
CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT=/path/to/projects   # mandatory, fail-closed
CODEBUDDY_PEER_TOOL_ALLOWLIST=view_file,list_directory,search   # default, optional
CODEBUDDY_PEER_ROLE=leaf                               # recommended on pure-spoke peers
```

---

## Configuration via env vars

All configuration lives in env vars (no TOML for fleet yet — to
match the rest of Code Buddy's server-side config). A `.env` file at
the repo root is loaded at boot via `dotenv`.

### Provider auto-detection (Phase (d).16a)

`buddy server` at boot calls `createPeerChatClientFromEnv()` which
walks env keys in priority order:

1. **`CODEBUDDY_PEER_PROVIDER`** explicit override — `chatgpt` |
   `ollama` | `gemini-cli` | `grok` | `anthropic` | `gemini` |
   `openai`. Skips auto-detect.
2. **ChatGPT Codex OAuth** (`buddy login chatgpt` or shared Codex CLI
   login) → ChatGPT subscription. Default model `gpt-5.5`; honors
   `CHATGPT_MODEL`.
3. **`OLLAMA_HOST`** set → Ollama (local, free). Default model
   `qwen2.5-coder:7b`.
4. **Gemini CLI** (`GEMINI_CLI_PATH` or `gemini` on PATH) → Gemini
   subscription. Default model `gemini-3.1-pro-preview`.
5. **`GROK_API_KEY`** → xAI Grok. Default model `grok-3`. Honors
   `GROK_BASE_URL` override.
6. **`ANTHROPIC_API_KEY`** → Claude. Default model `claude-sonnet-4-6`.
7. **`GOOGLE_API_KEY`** OR **`GEMINI_API_KEY`** → Gemini. Default
   model `gemini-2.5-flash`.
8. **`OPENAI_API_KEY`** → GPT. Default model `gpt-4o`.
9. None → `null` (peer.chat answers `CLIENT_UNAVAILABLE`).

`CODEBUDDY_PEER_MODEL` overrides the default model for whichever
provider is selected.

### Anti-loop / role config (Phase (d).14)

- **`CODEBUDDY_PEER_MAX_DEPTH`** (default `3`) — chain depth cap.
  When a `peer.invoke` chain (peer A calls B which calls C which
  calls...) reaches depth+1 = 4, the dispatcher returns
  `MAX_DEPTH_EXCEEDED`.
- **`CODEBUDDY_PEER_ROLE`** (default `main`) — one of `main`,
  `orchestrator`, `leaf`. Setting `leaf` makes the peer's `request()`
  client refuse outgoing invokes (it can still answer incoming).
  Useful for service-only peers (Ollama backend, no autonomous
  initiative).

### Authentication

- **`CODEBUDDY_FLEET_API_KEY`** (caller side) — default key passed
  to `/fleet listen` when `--api-key` is omitted.
- Server API keys are configured on the peer with:

  ```bash
  buddy api-key create --name "Fleet peer" --scope fleet:listen --scope peer:invoke
  buddy api-key list
  ```

  Only a hash is stored in `~/.codebuddy/server-api-keys.json`; the full key is
  printed once. Fleet usage needs the `fleet:listen` scope (read-only events)
  and/or `peer:invoke` scope (active RPC).
- In Cowork, the Fleet panel's key button creates the same local server key
  through the embedded Code Buddy engine and shows the full value once for
  copying to another peer.
- The Fleet panel's scan button runs the same Tailscale/manual YAML discovery
  path as the boot-time background scan. Manual YAML entries that include an
  `apiKey` can be added directly; peers without a key prefill the add form.
  Tailscale discovery probes `buddy server` on port 3000 first, then the legacy
  gateway port 3001. Override with `CODEBUDDY_FLEET_DISCOVERY_PORTS=3000,3001`
  if your lab uses different ports.

### Hostname identification (Phase (d).1)

- **`CODEBUDDY_FLEET_HOSTNAME`** — overrides `os.hostname()` in the
  `source.hostname` field of every fleet:* event. Useful when you
  want a peer to advertise itself as "darkstar-gpu" instead of the
  raw OS hostname.

### Backpressure (Phase (d).7 + (d).8)

- **`CODEBUDDY_FLEET_BROADCAST_BUFFER_LIMIT`** (default 2 MiB) —
  per-client `ws.bufferedAmount` ceiling. Above this, broadcasts to
  that client are dropped (a stuck peer can't memory-bloat the server).

### Auto-compact (post-audit, helper available)

- **`CODEBUDDY_AUTOCOMPACT_BUFFER_TOKENS`** (Phase post-audit) —
  reserved tokens above which compaction triggers. The new
  `computeAutoCompactThreshold` helper supports per-model lookups; the
  env override is global. Helper not yet wired by default in
  `shouldAutoCompact` — see `src/context/auto-compact-threshold.ts`
  + the v1-readiness plan (V1.3).

---

## Concrete example — Patrice's lab setup

3 hosts on a Tailscale private network:

| Host | Tailscale IP | Role | Provider |
|------|-------------|------|----------|
| **MINISTAR** (G7 PT) | `100.90.108.4` | Dev principal | Claude Max + Gemini Ultra |
| **DARKSTAR** (PC 3090) | `100.73.222.64` | Heavy GPU | Ollama (qwen3.6:35b) + cloud fallback |
| **Ministar Linux** | `100.98.18.76` | Always-on hub | Ollama (qwen3.6, qwen3, gemma4, nomic-embed) |

### Bootstrap the hub on Ministar Linux (Ubuntu)

```bash
# In /home/patrice/code-buddy
export GOOGLE_API_KEY="AIza..."         # → cloud fallback when needed
export OLLAMA_HOST="http://localhost:11434"   # → priority 1
export CODEBUDDY_FLEET_HOSTNAME="ministar-ubuntu"
export CODEBUDDY_FLEET_API_KEY="cb_sk_xxx"

buddy server --port 3000
# log: [fleet] peer.chat wired: ollama (qwen2.5-coder:7b, local)
```

### Connect from MINISTAR (Windows G7 PT)

```bash
# In D:\CascadeProjects\grok-cli
# .env already loads the keys
buddy
> /fleet listen ws://100.98.18.76:3000/ws --auto-reconnect --name ministar-linux --api-key $env:CODEBUDDY_FLEET_API_KEY
> /fleet status
# → 1 active. Provider on remote = ollama qwen2.5-coder:7b.

> /fleet send ministar-linux peer.chat {"prompt":"Refactor this for clarity:\n\nfunction f(x) { return x.split(',').map(s => s.trim()).filter(Boolean) }"}
# → REAL response from local Qwen on the Linux host. Zero cloud cost.
```

### Connect from DARKSTAR (Windows PC 3090)

Same as MINISTAR but pointing at its own Tailscale IP if it also
runs a `buddy server` exposing its local Ollama. Then any peer can
delegate code drafts to DARKSTAR's heavier model:

```bash
# On any peer
> /fleet send darkstar peer.chat {"prompt":"Generate Rust impl for trait Foo with method bar"}
# → DARKSTAR's qwen3.6:35b answers. Free + fast.
```

---

## Smoke test recipe

After deploying / restart, validate the fleet end-to-end:

```bash
# Terminal 1 — start a server with peer.chat wired
GOOGLE_API_KEY="..." buddy server --port 3001
# → wait for the boot log: "[fleet] peer.chat wired: gemini (gemini-2.5-flash)"

# Terminal 2 — connect + smoke
buddy
> /fleet listen ws://localhost:3001/ws --auto-reconnect --api-key $env:CODEBUDDY_FLEET_API_KEY --name self
> /fleet send self peer.ping
# → { pong: true, serverTime: ... } < 50ms
> /fleet send self peer.describe
# → see methods + peerChatProvider populated
> /fleet send self peer.chat {"prompt":"Say hi briefly"}
# → real Gemini response, ~30 tokens of quota
> /fleet history --peer self
# → at least 4 events captured (heartbeat + the 3 above)
> /fleet stop self
```

If all 5 commands return as documented, your fleet is operational.

---

## Security model (V0.4.1, may evolve)

- **Scope-gated**: peers must hold the right `ApiScope`
  (`fleet:listen` for read-only events, `peer:invoke` for active RPC).
  Without those, the WS handler returns FORBIDDEN.
- **Network-gated**: the recommended deployment is over a Tailscale
  private network (CGNAT IPs `100.x.x.x`). Don't expose `0.0.0.0:3000`
  directly to the internet without a reverse proxy + auth.
- **Anti-loop**: `CODEBUDDY_PEER_MAX_DEPTH` + `traceId` propagation
  prevent recursive call chains (peer A → B → C → A → infinite).
- **Role refusal**: `CODEBUDDY_PEER_ROLE=leaf` for service-only peers
  that should answer but never initiate.
- **Backpressure**: a stuck peer can't memory-bloat the server's
  ws send buffer (drop-on-overflow at 2 MiB per client).

What's NOT yet enforced (V1.x roadmap):
- Per-method permission gating (e.g. `peer:chat:invoke` sub-scope).
  Today `peer:invoke` lets the caller use any registered method.
- Rate cap per peer (deferred to (d).16b — defer until burn-rate
  problems observed live).
- Audit logging of every peer.invoke for compliance.

---

## Phases (d).17 → (d).20 — V1.0.0 additions

The fleet through Phase (d).16a was peer-RPC plumbing. Phases (d).17 →
(d).20 turn it into actual multi-Claude orchestration.

### `peer_delegate` + `list_peers` LLM tools (Phase d.17)

Two new tools registered on every Code Buddy:

- `list_peers()` — read-only snapshot of `FleetRegistry`. Returns peer
  ids + URL + last-seen + compaction state + `peerChatLikelyAvailable`
  hint. No RPC round-trips.
- `peer_delegate(peer, prompt, [systemPrompt], [model], [timeoutMs])` —
  wraps `peer.chat`. Returns the peer's text response, usage, traceId.

Anti-loop guards stack: the existing `CODEBUDDY_PEER_ROLE=leaf` refusal
+ the new per-turn cap (default 5, env
`CODEBUDDY_PEER_DELEGATE_MAX_PER_TURN`) + depth cap. The LLM gets a
`<fleet>` system-prompt nudge whenever peer count > 0.

When the human runs `/fleet listen ws://peer …`, the LLM thereafter
can autonomously decide to delegate without a copy-paste step:

```
User: ask the darkstar peer how it would index a 50M-row table
LLM: [calls list_peers, sees darkstar healthy, calls peer_delegate({peer: 'darkstar', ...})]
LLM (continuing with peer's answer in context): "darkstar suggests …"
```

### Autonomous Fleet Protocol v0.1 (Phase d.18)

Fleet bus = the `claude-et-patrice/.codebuddy/` repo on a shared
Tailscale mesh. Each peer periodically:

1. `git pull --rebase`
2. Reads `.codebuddy/HEARTBEAT.md` for FLEET_PAUSE keyword
3. Picks a claimable task in `colab-tasks.json` (open + claimedBy null,
   priority cascade — `critical` is always SKIPPED for autonomous
   claim, requires human validation)
4. Atomic claim: mutate JSON, commit, push. Race-loss → abort.
5. Spawn an in-process `CodeBuddyAgent` with a strict task prompt;
   parse the JSON tail.
6. Scope guard: `git diff --name-only` ⊆ `task.filesToModify`,
   else rollback + mark blocked.
7. Append `colab-worklog.json` entry, mark task completed, push.

Configure via TOML `[autonomous_fleet]`:

```toml
[autonomous_fleet]
enabled = true
repo_path = "/path/to/claude-et-patrice"
host = "ministar/grok-cli"
interval_minutes = 30
max_task_ms = 600000
priority_threshold = "high"   # critical always skipped
llm_provider = "auto"         # cloud (default) | auto | ollama | grok | …
```

Slash commands: `/fleet autonomous status` (preview resolved provider),
`/fleet autonomous tick-now` (one-shot tick). The Python wrapper
`claude-et-patrice/tools/heartbeat_tick.py` remains as the V0
reference — same protocol, same files.

### `peer.chat-stream` V1.1 (Phase d.19)

Streaming variant of `peer.chat`. New wire frame `peer:chunk` carries
`{ id, delta }`; server-side `peer.chat-stream` method calls
`client.chatStream()` and pushes deltas via `ctx.emitChunk`. Final
`peer:response` still arrives with the aggregated text (back-compat).

Client-side: `FleetListener.requestStream(method, params, onChunk,
options)` routes per-request chunks to the callback.

```ts
await listener.requestStream(
  'peer.chat-stream',
  { prompt: 'explain the bug' },
  (delta) => process.stdout.write(delta),
  { timeoutMs: 60_000 },
);
```

Useful for long generations where the caller wants visibility into
in-flight progress. `peer_delegate` (Phase d.17) currently aggregates
locally — the streaming path is for power users via `/fleet send`.

### `peer.chat-session.*` V1.2 (Phase d.21)

Multi-turn conversations between peers. Where `peer.chat` is a
stateless one-shot (every call rebuilds context from scratch), this
trio holds conversation state **in-memory on the peer that hosts the
LLM client**. The caller manages the lifecycle: open with `start`,
append turns with `continue`, close with `end`.

#### Methods

- `peer.chat-session.start({ systemPrompt?, model? })`
  → `{ sessionId, expiresAt, traceId }`
- `peer.chat-session.continue({ sessionId, prompt })`
  → `{ text, finishReason, usage, traceId }`
- `peer.chat-session.continue-stream({ sessionId, prompt })`
  → `{ text, finishReason, usage, traceId }` plus `peer:chunk` frames
  emitted live for each assistant delta. Same FIFO serialisation and
  persistence as `continue` ; useful when a turn is expected to be
  long and the caller wants visibility into in-flight output. If
  the stream errors before any delta arrives, the user message is
  rolled back ; if some text was already produced, that partial
  answer is persisted so the next turn sees it.
- `peer.chat-session.list()`
  → `{ count, sessions: [{ sessionId, turnCount, model?, ageMs, idleMs,
  expiresInMs }], traceId }`. Read-only metadata snapshot, never
  returns prompt content or assistant text. Used by `/fleet status
  --with-sessions` and external monitoring.
- `peer.chat-session.end({ sessionId })`
  → `{ closed: boolean, traceId }`

#### Idle TTL

Default 30 min, reset to "now" on every `continue`. Override via
`CODEBUDDY_PEER_SESSION_IDLE_MS`. Sessions self-purge opportunistically
at the top of each `start`/`continue` — no setInterval timer.

#### Concurrency

Concurrent `continue` calls on the same sessionId are serialised FIFO
(promise-chained per session) so assistant messages can't interleave
on shared `messages` history. Different sessions run independently.

#### Persistence (V1.2-saga, Phase d.22)

Sessions persist to `~/.codebuddy/peer-sessions/<sessionId>.json` using
the same lockfile + atomic-rename pattern as the saga store. On peer
restart, sessions younger than `CODEBUDDY_PEER_SESSION_IDLE_MS` are
re-hydrated before the RPC methods are registered, so the first
incoming `peer.chat-session.continue` already sees the historic state.
Older entries are purged at boot.

Storage is local to the peer hosting the LLM client — there is no
cross-host replication. Two `buddy server` processes sharing the same
directory is not a supported topology.

#### Observability — `fleet:chat-session:*` events

Three events are emitted on the fleet bus during a chat session
lifecycle, visible to `/fleet listen` consumers and recorded by
`/fleet history`:

- `fleet:chat-session:start` — payload `{ sessionId, model? }`
- `fleet:chat-session:turn`  — payload `{ sessionId, turnCount, elapsedMs?, usage? }`
- `fleet:chat-session:end`   — payload `{ sessionId, reason: 'end' | 'expired' }`

**Privacy**: payloads carry **metadata only** — no prompt content, no
assistant text, no system prompt. A remote `/fleet listen` consumer
sees that a session is active and how many turns have been exchanged,
but never the conversation itself. Useful for `/fleet status`-style
monitoring without compromising conversation privacy.

#### Limitations (V1.2-saga)

- ~~**In-memory only**~~ — **persisted** as of V1.2-saga (Phase d.22).
  Sessions survive peer restart up to the idle TTL.
- **No tools** — call surface mirrors `peer.chat` / `/btw`. Exposing
  remote tools is V1.3 (`peer.tool.invoke`), gated behind a serious
  permission design.
- **Caller-owned cleanup** — peers won't close sessions for you
  unless they idle out. Always `end` what you `start`.
- **Single-process** — two `buddy server` processes sharing the same
  `~/.codebuddy/peer-sessions/` directory is not supported.
- **No content encryption at rest** — disk encryption is the user's
  responsibility (same as the saga store).

#### Errors

- `SESSION_NOT_FOUND` — sessionId unknown (typo, wrong peer, or already ended)
- `SESSION_EXPIRED` — idled past the TTL between turns (rare; usually
  surfaces as `SESSION_NOT_FOUND` because GC runs first)
- `CLIENT_UNAVAILABLE` — peer has no LLM client wired (peer.chat would
  return the same)

#### Example

```bash
> /fleet send ministar-linux peer.chat-session.start \
    {"systemPrompt":"Tu es un expert Rust","model":"qwen2.5-coder:7b"}
# → { sessionId: "sess_lpz4xy_h2k1", expiresAt: 1715380000000, ... }

> /fleet send ministar-linux peer.chat-session.continue \
    {"sessionId":"sess_lpz4xy_h2k1","prompt":"Donne-moi un exemple de borrow checker"}
# → { text: "Voici un exemple..." }

> /fleet send ministar-linux peer.chat-session.continue \
    {"sessionId":"sess_lpz4xy_h2k1","prompt":"Maintenant montre comment le fixer avec des lifetimes"}
# → { text: "Tu peux écrire..." }    # ← le peer se souvient du précédent

> /fleet send ministar-linux peer.chat-session.end \
    {"sessionId":"sess_lpz4xy_h2k1"}
# → { closed: true }
```

#### `/fleet chat` slash helper (V1.2.1)

UX wrapper over `peer.chat-session.*` that drops the need to copy
`sessionId` between turns. Sub-actions: `start`, `say`, `end`, `list`.

```bash
> /fleet chat start ministar-linux --system "Tu es un expert Rust" --model qwen2.5-coder:7b
# → Chat session "ministar-linux-1" opened with ministar-linux (sessionId=sess_lpz4xy_h2k…).
#   Send turns with /fleet chat say <message>.

> /fleet chat say Donne-moi un exemple de borrow checker
# ← ministar-linux-1 (ministar-linux) [turn 1, 2300ms]:
# Voici un exemple...

> /fleet chat say Maintenant montre comment le fixer avec des lifetimes
# ← ministar-linux-1 (ministar-linux) [turn 2, 3100ms]:
# Tu peux écrire...

> /fleet chat list
# Active chat sessions (1):
#   ministar-linux-1     → ministar-linux     [turn 2, 5s ago, model qwen2.5-coder:7b]   ← active

> /fleet chat end
# Chat session "ministar-linux-1" closed.
```

Aliases default to `<peer>-1`, `<peer>-2`, … and can be overridden with
`--name <alias>`. The "active" session resolves to the unique one when
there's only one open, or to the last `start` otherwise. Pass
`--session <alias>` on `say` / `end` to disambiguate.

`/fleet stop <peer>` and `/fleet stop --all` auto-purge any chat
sessions tied to the peer being closed (server-side will TTL out within
the `CODEBUDDY_PEER_SESSION_IDLE_MS` window).

### Autonomous v0.2 — Ollama spokes (Phase d.20)

Per-task or per-host LLM routing for the autonomous protocol:

- Per-task: `FleetTask.preferLocal: true` → routes that task to Ollama
  if `OLLAMA_HOST` is set (otherwise falls through to host config).
- Per-host: `[autonomous_fleet].llm_provider`:
  - `'cloud'` (default V0.1, backward-compat) — uses GROK env vars
  - `'auto'` — factory auto-detect (Ollama first if available)
  - `'<id>'` — forces that provider (`'ollama'`, `'grok'`, `'anthropic'`,
    `'gemini'`, `'openai'`)

Worklog entries record `provider` + `model` for cost audit. `/fleet
autonomous status` shows the resolved provider preview. Backward-compat
strict — V0.1 default unchanged unless TOML is edited.

Use case: heavy reasoning on a Claude Max peer, mechanical lint /
summary tasks on a local Qwen via Ollama, vision on a Gemini peer —
all coordinated by the same fleet protocol.

---

## Wiring end-to-end (post-2026-05-09)

Phase (e).1-(e).8 a livré 8 modules (capability registry, task router,
saga store, result aggregator, privacy lint, cost tracker, Tailscale
discovery, FleetCommandCenter UI). Le wiring W1-W6 (mai 2026) les
connecte en flow complet :

| Wiring | Effet |
|---|---|
| **W1** — `fleet.dispatch` IPC fire `peer.dispatch` sur chaque step | `cowork/src/main/ipc/fleet-ipc.ts` + `cowork/src/main/fleet/saga-runner.ts` |
| **W2** — Cowork poll `peer.dispatchStatus` toutes les 2s, met à jour saga step | `SagaRunner.pollStatus` |
| **W3** — Auto-call aggregator quand tous les parallel steps terminal | `SagaRunner.maybeFinalise` → `aggregateParallelResults` ou `finaliseFromSingle` |
| **W4** — Privacy lint scan le goal AVANT le router (auto-bump à `sensitive`) | `fleet.dispatch` IPC handler |
| **W5** — Cost cap `canSpend()` vérifié AVANT chaque dispatch | `fleet.dispatch` IPC handler |
| **W6** — `discoverPeers()` Tailscale + YAML appelé au boot + toutes les 5 min | `cowork/src/main/index.ts` + IPC `fleet.discoverPeers` |

### Flow complet d'une dispatch

```
1. UI dispatche un goal via fleet.dispatch IPC
2. Privacy lint scan le prompt (W4)
   ├─ secrets détectés → privacyTag bumped à 'sensitive'
   └─ caller a forcé 'public' avec secrets → reject
3. Cost cap canSpend() (W5)
   └─ daily cap atteint → reject
4. TaskRouter.plan() avec peers + capabilities
5. SagaStore.create() → saga persistée à ~/.codebuddy/sagas/<id>.json
6. SagaRunner.start(sagaId) — handoff async
7. Pour chaque step (séquentiel ou parallel):
   a. Marque step 'running' + emit fleet.saga.update
   b. fleetBridge.peerRequest('peer.dispatch', {prompt, model})
   c. Reçoit {runId} immédiatement
   d. Poll fleetBridge.peerRequest('peer.dispatchStatus', {runId}) toutes les 2s
   e. Status terminal → completeStep ou failStep
   f. Emit fleet.saga.update
8. Si parallel + au moins un completed → aggregateParallelResults() → finalise()
9. Si séquentiel → finaliseFromSingle() → finalise()
10. Renderer reçoit fleet.saga.update → re-fetch saga via fleet.listSagas
```

Sequential primary+fallback : si `primary` réussit, `fallback` est
**skip**, pas dispatché. Si `primary` échoue, `fallback` est tenté.

---

## Code Buddy Gateway vs OpenClaw Gateway

Code Buddy peut s'appuyer sur **deux gateways indépendants et
complémentaires**. Ne pas confondre :

| Aspect | **Code Buddy Gateway** | **OpenClaw Gateway** |
|---|---|---|
| Daemon | `buddy --serve` / `buddy server` | `openclaw gateway` (repo upstream) |
| Port défaut | 3001 (WS) / 3000 (HTTP) | configurable, ≠ 3001 |
| Lockfile | aucun | `~/.openclaw/gateway.json` |
| Workspace | `~/.codebuddy/` | `~/.openclaw/workspace/` |
| Implémentation | propriétaire `src/gateway/server.ts` + `src/server/websocket/` | upstream openclaw, daemon séparé |
| Rôle | **Bus AI peer-to-peer** : agents ↔ agents, dispatch, sagas | **Bus multi-channel humain** : Telegram, WhatsApp, Discord, iMessage, Slack |
| Statut | shippé Phases (d).1-(d).16a + (e).1-(e).8 | intégration Phase (e).7 *(reportée — besoin daemon installé)* |

### Coexistence sans conflit

Les deux gateways peuvent tourner **côte à côte sur la même machine**.
Pas de collision de port, fichiers ou socket :

```
Ministar Linux
├─ port 3001 ─── Code Buddy Gateway   (buddy --serve)
│                ├─ Cowork local
│                ├─ peer DARKSTAR via Tailscale
│                └─ peer cloud agent
│
└─ port ???? ─── OpenClaw Gateway     (openclaw gateway)
                 ├─ canal Telegram
                 ├─ canal WhatsApp
                 ├─ canal iMessage
                 └─ skills SKILL.md
```

### Quand utiliser lequel

| Tu veux… | Tu lances… |
|---|---|
| Multi-provider AI parallèle (Claude+Ollama+Gemini sur même goal) | **Code Buddy Gateway seul** |
| Multi-machine via Tailscale (Ministar + DARKSTAR + G7 PT) | **Code Buddy Gateway seul** |
| Dispatch automatique avec scoring capability/cost/load/latency | **Code Buddy Gateway seul** |
| Recevoir messages Telegram/WhatsApp/Discord et les router à un agent | **+ OpenClaw Gateway** |
| Skills via marketplace ClawHub | **+ OpenClaw Gateway** |
| Intégrations Gmail/GitHub/Spotify/iMessage natives | **+ OpenClaw Gateway** |

**Recommandation** : commence avec le seul Code Buddy Gateway.
Branche OpenClaw quand tu veux les canaux externes — c'est un
add-on, pas un remplacement.

### Topologie quand les deux tournent (Phase (e).7)

```
Telegram → OpenClaw Gateway → openclaw-node bridge → Cowork ServerEvent
                                                  → TaskRouter (e.3)
                                                  → peer.dispatch sur Code Buddy Gateway
                                                  → peer DARKSTAR fait le travail
                                                  → résultat remonte
                                                  → openclaw-node → OpenClaw Gateway → Telegram
```

Le `openclaw-node` Cowork (Phase (e).7, à coder) lit
`~/.openclaw/gateway.json` pour découvrir le daemon, s'enregistre
comme nœud, et **forward les messages dans la fleet Code Buddy**.
La fleet Code Buddy reste le brain ; OpenClaw apporte les canaux.

### Trois scénarios concrets

**1. Tout local, sans OpenClaw** (état au 2026-05-09)
- `buddy --serve` sur Ministar et DARKSTAR
- Cowork dispatche depuis le FleetCommandCenter
- Pas besoin d'OpenClaw

**2. Avec OpenClaw mais sans channels externes**
- `openclaw gateway` tourne dans un coin
- Cowork pair avec lui (Phase (e).7)
- Skills installées via `clawhub` accessibles à la fleet Code Buddy

**3. Full multi-channel**
- `openclaw gateway` + canal Telegram configuré (`openclaw onboard`)
- Message Telegram → Gateway → openclaw-node → Cowork → TaskRouter
  dispatche sur Ollama DARKSTAR
- Réponse remonte par le même chemin

---

## Roadmap (post-V1)

- ~~**V1.2** — `peer.chat-session.start/.continue/.end` (multi-tour
  conversations between peers, with state held server-side).~~
  **✅ Shipped Phase d.21** — see section above. Idle TTL 30 min,
  in-memory state, FIFO-serialised concurrent continues.
- **V1.3** — `peer.tool.invoke` (more powerful, more risky — exposing
  the peer's local tools to remote callers requires a serious
  permission design).
- **V1.4** — Fleet of fleets (a peer that fans events from N upstream
  peers to its own clients). Extends the singleton listener pattern
  to a Map of upstreams.
- **V2.0** — Federated identity (cross-host keys, capability
  certificates) so peers don't need to trust the same shared key.

---

## See also

- [`CHANGELOG.md`](../CHANGELOG.md) — release notes per phase
- [`CLAUDE.md`](../CLAUDE.md) — overall architecture for AI assistants
  working in this repo
- [`docs/security.md`](security.md) — permission modes, scopes,
  Guardian Agent
- [`docs/configuration.md`](configuration.md) — full env var reference
- `src/fleet/peer-chat-bridge.ts` — bridge implementation
- `src/fleet/peer-chat-client-factory.ts` — env-driven detection
- `src/server/websocket/peer-rpc.ts` — registry + dispatcher
- `claude-et-patrice/propositions/AUDIT-COMPACTION-CLAUDE-CODE-2026-05-04.md` —
  comparative audit that informed two recent fixes
