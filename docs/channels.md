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
