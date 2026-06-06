# Channels

Code Buddy supports 20+ messaging channels for remote interaction.

## Supported Channels

| Channel | Transport | Key Features |
|:--------|:----------|:-------------|
| **Terminal** | Native CLI (Ink/React) | Default interface |
| **HTTP API** | REST + WebSocket | OpenAI-compatible API |
| **WebChat** | HTTP + WebSocket | Built-in browser UI |
| **Telegram** | Bot API | Pro features, scoped auth, CI watcher, rich media |
| **Discord** | Bot integration | Slash commands, guild support |
| **Slack** | Bolt framework | Events, Block Kit formatting |
| **WhatsApp** | Baileys | QR pairing, media, reconnect |
| **Signal** | signal-cli REST API | Polling, groups |
| **Google Chat** | Workspace API | JWT auth, webhook events |
| **Microsoft Teams** | Bot Framework | OAuth2, adaptive cards |
| **Matrix** | matrix-js-sdk | E2EE, threads, media |
| **DingTalk** | Custom robot webhook | Text/markdown messages, HMAC-signed webhooks |
| **WeCom** | Group robot webhook | Text/markdown messages, group mentions |
| **Weixin/WeChat Official Account** | Customer service API | Text messages to OpenID recipients |
| **QQ** | OneBot v11 HTTP | Private/group messages through a QQ bot gateway |
| **IRC** | Native | SASL auth, TLS, multi-channel |
| **Feishu/Lark** | API | Interactive cards, reasoning hooks, identity-aware headers |
| **Synology Chat** | Webhooks | Incoming/outgoing webhooks |
| **ntfy** | HTTP POST | Push notifications to self-hosted or ntfy.sh topics |
| **LINE** | Messaging API | Rich messages |
| **Nostr** | Relay protocol | Decentralized |
| **Zalo** | OA API | Vietnam market |
| **Mattermost** | API | Self-hosted Slack alternative |
| **Nextcloud Talk** | API | On-premise collaboration |
| **Twilio Voice** | TwiML | Voice calls |
| **iMessage** | AppleScript | macOS only |
| **Twitch** | IRC-based | Chat integration |
| **Gmail** | Pub/Sub | Webhook notifications |

## Starting a Channel

```bash
buddy --channel telegram        # Start with Telegram
buddy --channel discord         # Start with Discord
buddy daemon start              # 24/7 background with configured channels
```

## DM Pairing (Access Control)

Prevents unauthorized users from consuming API credits:

1. Unknown user messages the bot and receives a **6-character pairing code** (expires in 15 min)
2. Bot owner approves via CLI: `buddy pairing approve ABC123`
3. User is added to the persistent allowlist

Security: rate limiting (5 failed attempts triggers 1-hour block), per-channel allowlists, admin bypass.

```bash
buddy pairing status             # Pairing system status
buddy pairing list               # All approved users
buddy pairing pending            # Pending requests
buddy pairing approve <code>     # Approve by code
buddy pairing add <id>           # Manually add user
buddy pairing revoke <id>        # Revoke access
```

## Send Policy

Rule-based deny/allow per channel, chatType, keyPrefix, and peerId. Runtime overrides via `/send on|off|inherit`. Configured in `src/channels/send-policy.ts`.

## Companion Gateway Inbox

For OpenClaw-style human-channel operation, Code Buddy keeps the channel layer
separate from automatic action. `recordCompanionGatewayMessage()` can accept
messages from enabled companion channels and records them into a local review
queue:

```text
.codebuddy/companion/gateway-inbox.json
```

Each item includes source channel, thread, sender, redacted preview, priority,
proposed action, and safety flags. Raw message text is not stored in the inbox,
token-like strings are redacted, and `canAutoDispatch` is always `false`.
Cowork renders the same queue in `Buddy companion -> Gateway inbox` through the
read-only `companion.gateway.inbox` IPC handler. A queued item can be converted
locally into a draft-only `buddy autonomous-code --task-file ... --require-approval`
task through `companion.gateway.draft`; the draft is written under
`.codebuddy/companion/gateway-drafts/` and is not dispatched automatically.

Validation:

```bash
npm test -- tests/companion-gateway.test.ts
cd cowork && npm test -- tests/hermes-surfaces-ipc.test.ts
```

This is intentionally a supervised inbox, not an OpenClaw-style unrestricted
remote executor. The next step is routing approved drafts into Fleet while
keeping explicit local approval and no auto-dispatch.

## Message Preprocessing

4-stage inbound pipeline:
1. **Media detection** -- identify attached files and images
2. **Audio transcription** -- STT for voice messages
3. **Link extraction** -- pull URLs from text
4. **Content enrichment** -- fetch and summarize linked content

## Telegram (Deep Dive)

Telegram is the most feature-rich channel. Setup:

1. Create a bot with [@BotFather](https://t.me/BotFather)
2. Set `TELEGRAM_BOT_TOKEN` or configure in `.codebuddy/settings.json`
3. Start: `buddy --channel telegram` or `buddy daemon start`

**Deployment modes**: Polling (default, works behind NAT) or Webhook (lower latency).

**Supported message types**: text, images, audio, video, documents, stickers, locations, contacts, inline buttons, reply threads, typing indicators.

**Pro features** (lazy-loaded via `src/channels/pro/`):

| Feature | Description |
|:--------|:------------|
| Scoped Authorization | Tiered: `read-only` -> `write-patch` -> `run-tests` -> `deploy` |
| Diff-First Mode | Preview code changes before applying (Apply/Full Diff/Cancel buttons) |
| Run Tracker | Step-by-step timeline with cost, duration, artifacts |
| CI Watcher | GitHub Actions / GitLab CI / Jenkins alerts with "Fix it" auto-agent |

## Slack Block Kit

`SlackBlockBuilder` fluent API converts markdown responses to Slack Block Kit format. Pass custom blocks via `channelData.slack.blocks` in `OutboundMessage`.

## Feishu Cards

Interactive approval/launcher cards, reasoning stream hooks, identity-aware headers, and full thread context support.

## Channel Configuration

Configure channels in `.codebuddy/settings.json`:

```json
{
  "channels": {
    "telegram": {
      "type": "telegram",
      "token": "123456:ABC-DEF...",
      "adminUsers": ["your_telegram_user_id"]
    },
    "discord": {
      "type": "discord",
      "token": "discord-bot-token",
      "allowedGuilds": ["guild-id"]
    }
  }
}
```
