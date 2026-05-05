# Channel → A2A bridge

## What this is

When the Code Buddy hub HTTP server starts, it now auto-loads any
channels declared in `.codebuddy/channels.json` (Telegram, Discord,
Slack, Matrix, IRC, Signal, ...) and forwards every inbound message
to the local A2A task router. The reply from the A2A spoke (e.g. an
Ollama model) is sent back to the originating channel as a reply to
the user's message.

This replaces the standalone Python wrapper `scripts/telegram_a2a_spoke.py`
that hand-rolled the same flow for Telegram only. The new bridge lives
inside the hub process, supports all 23 channels uniformly, and reuses
the existing channel infrastructure (auth, formatting, reconnect,
ScopedAuth) instead of duplicating it.

## How it works

```
                          ┌─────────────────────────────┐
                          │ Code Buddy hub (this server) │
 phone ───Telegram──▶ │                              │
                          │  ChannelManager (singleton)  │
                          │     │                        │
                          │     ▼                        │
                          │  startChannelA2ABridge()     │
                          │     │                        │
                          │     ▼                        │
                          │  POST /api/a2a/tasks/send    │ ── routes to spoke ──▶
                          │     │                        │     (Ollama, ...)
                          │     ▼                        │ ◀── result ──
                          │  channel.send(reply)         │
                          │                              │
                          └─────────────────────────────┘
```

Single new file: `src/server/channel-a2a-bridge.ts`. It registers a
handler on `ChannelManager.onMessage()` that:

1. Checks the channel's allow-list (`BaseChannel.isUserAllowed`).
2. Parses commands (`/skill`, `/agent`, `/help`, `/start`).
3. POSTs an A2A task payload to `http://127.0.0.1:{hubPort}/api/a2a/tasks/send`.
4. Sends the result back via `channel.send()`.

The auto-boot lives in `src/server/index.ts` next to the other
fleet bridges (heartbeat broadcaster, compaction bridge, peer.chat).

## Setup — Telegram example

### 1. Create a bot

On Telegram, open `@BotFather`:
- `/newbot`
- Pick a display name + username (must end in `bot`).
- Copy the token (looks like `1234567890:ABC-DEF1234ghIkl…`).

### 2. Find your user id

Send any message to your bot. Then in a PowerShell / shell where the
hub will run:
```powershell
$env:TELEGRAM_BOT_TOKEN = "<your-token>"
curl "https://api.telegram.org/bot$env:TELEGRAM_BOT_TOKEN/getUpdates" |
    ConvertFrom-Json | Select-Object -ExpandProperty result |
    ForEach-Object { $_.message.from }
```
The `id` field on your message is your user id (a number).

### 3. Configure the channel

Create `.codebuddy/channels.json` at the repo root (or
`~/.codebuddy/channels.json` for user-scope):

```json
{
  "channels": [
    {
      "type": "telegram",
      "enabled": true,
      "token": "1234567890:ABC-DEF1234ghIkl…",
      "allowedUsers": ["<your-user-id-as-string>"]
    }
  ]
}
```

`allowedUsers` is **mandatory in practice** — without it, anyone who
finds the bot can use it (and it routes to *your* spokes). The hub
will refuse to forward messages from unlisted users with a warning in
the logs.

### 4. (Optional) tune defaults

Two env vars override the bridge defaults:
- `A2A_BRIDGE_DEFAULT_SKILL` — default skill ID for plain text
  messages (default `ollama-qwen3-4b`).
- `A2A_BRIDGE_DEFAULT_MODEL` — `metadata.model` attached to every
  task (default `qwen3:4b`).
- `A2A_BRIDGE_DEFAULT_AGENT` — fallback when no skill is configured;
  routes to a specific spoke by name.

### 5. Start the hub

```bash
npm run dev
# or in production: systemctl restart codebuddy-a2a.service
```

The hub logs should show:
```
[channel-a2a-bridge] telegram channel started
[channel-a2a-bridge] active hubBaseUrl=http://127.0.0.1:3000 …
```

DM your bot from your phone. You should get a reply within a few
seconds.

## Bot commands

The bridge recognises a small set of slash commands. Anything else is
treated as plain text and routed via the default skill.

| Command | Effect |
|---|---|
| `/help`, `/start` | Reply locally with a capability summary, no hub call. |
| `/skill <id> <text>` | Route via an explicit A2A skill (e.g. `/skill ollama-gemma4-26b raconte une blague`). |
| `/agent <name> <text>` | Route via an explicit spoke agent (e.g. `/agent ollama-darkstar /think profond le sens de la vie`). |
| Anything else | Plain text → default skill, smart skill selection picks the spoke. |

## Other channels

The same `.codebuddy/channels.json` accepts entries for Discord,
Slack, Matrix, IRC, Signal, WhatsApp, … 23 channels in total. Each
channel's authentication and config fields differ — see the per-channel
guides under `src/channels/<channel>/` for the specifics. The bridge
itself is channel-agnostic; it only cares about `InboundMessage` events
on `ChannelManager`.

Example multi-channel config:
```json
{
  "channels": [
    { "type": "telegram", "enabled": true, "token": "…", "allowedUsers": ["123"] },
    { "type": "discord", "enabled": true, "token": "…", "allowedUsers": ["456"] },
    { "type": "matrix",  "enabled": false, "token": "…" }
  ]
}
```

## Migration from `scripts/telegram_a2a_spoke.py`

The old Python wrapper is deprecated but kept around for hosts that
can't run the Code Buddy server itself (e.g. DARKSTAR is currently
blocked on `better-sqlite3` for Node 24). Migration steps:

1. Stop the old wrapper (or its scheduled task `TelegramA2ASpoke`).
2. Move the bot token from `$env:TELEGRAM_BOT_TOKEN` to
   `.codebuddy/channels.json` as shown above.
3. Move `$env:TELEGRAM_ALLOWED_USER_IDS` from CSV to JSON array form
   under `allowedUsers`.
4. Restart the hub.

The user-facing behaviour is the same except:
- The bridge now lives inside the always-on hub on Ministar Linux
  rather than DARKSTAR's session — survives DARKSTAR sleep / reboot.
- Bonus: Discord, Slack, etc. work via the same path.

## Implementation notes

- **Why HTTP self-call rather than a direct method call**: the
  `A2AAgentClient` is instantiated per-route in
  `createA2AProtocolRoutes()` and not exported as a singleton. The
  loopback fetch sidesteps that for V0; refactoring to a singleton
  is a clean follow-up that won't change the bridge's API.
- **Coexistence with `/channels start` CLI**: if a CLI session
  registers `registerAIMessageHandler` on the same channel, both
  handlers run and the user gets two replies. Avoid mixing the two
  paths. V1 should refactor `registerAIMessageHandler` to be the
  same handler as the bridge with a routing-mode flag.
- **No streaming**: the bridge sends the full result in one message
  (chunked at the channel's max-length boundary). Streaming responses
  is a V2 enhancement that needs A2A streaming support first.
- **Errors**: hub-side failures (timeout, no spoke for skill, spoke
  returned `status: failed`) get a one-line user-facing message and a
  full log entry on the hub side.
