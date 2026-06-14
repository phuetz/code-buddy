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
| **IRC** | TCP/TLS (RFC 1459/2812) | SASL auth, TLS, multi-channel, auto-reconnect |
| **Feishu/Lark** | REST (outbound) | Interactive cards, reasoning hooks; real-time inbound needs the Lark SDK |
| **Synology Chat** | Webhooks | Incoming/outgoing webhooks |
| **ntfy** | HTTP POST | Push notifications to self-hosted or ntfy.sh topics |
| **LINE** | Messaging API | Rich messages |
| **Nostr** | WebSocket relays (NIP-01) | Decentralized, auto-reconnect; publishing needs a Schnorr signer |
| **Zalo** | OA API | Vietnam market |
| **Mattermost** | WebSocket + REST | Self-hosted Slack alternative, auto-reconnect |
| **Nextcloud Talk** | HTTP long-poll + REST | On-premise collaboration, auto-reconnect |
| **Twilio Voice** | TwiML | Voice calls |
| **iMessage** | AppleScript | macOS only |
| **Twitch** | IRC-based | Chat integration |
| **Gmail** | Pub/Sub | Webhook notifications |

> **Transport classes & auto-reconnect (2026-06-14).** Adapters with a persistent
> connection — Discord, Slack, Telegram, WhatsApp, Signal, Matrix, iMessage, and
> (added 2026-06-14) IRC, Nostr, Mattermost, Nextcloud Talk — are wired to a shared
> `ReconnectionManager` (exponential backoff + jitter) and auto-reconnect on drop.
> REST/webhook adapters (DingTalk, QQ, ntfy, LINE, Teams, Google Chat, …) have no
> socket to reconnect. Live delivery on any platform still requires that platform's
> token/account.

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
`.codebuddy/companion/gateway-drafts/` and is not dispatched automatically. A
prepared task can then create a safe Fleet handoff JSON through
`companion.gateway.fleetDraft`; that file contains the `fleet.dispatch` input
with `dispatchProfile=safe` and `privacyTag=sensitive`, but still does not call
`fleet.dispatch`. Cowork can launch that handoff only after the operator clicks
`Launch Fleet` and confirms the native approval dialog; the launch reuses the
central `fleet.dispatch` path and still does not send an outbound channel reply.
After Fleet review, Cowork can prepare a separate `Reply draft` for the same
gateway item through `companion.gateway.outboundReplyDraft`. The reply draft is
written as `.codebuddy/companion/gateway-drafts/*.reply.json`, requires a
reviewer name, stores only a redacted content preview, sets
`readyToSend=false`, and does not create a channel outbox entry.
The final send step is separate: `companion.gateway.sendOutboundReply` requires
the final reply text again, an `approvedBy` value, and
`liveDeliveryConfirmed=true` for live delivery. It delegates to
`executeSendMessage`, so previews and live sends both write the standard
`.codebuddy/messages/outbox.jsonl` record and live sends pass through
`SendPolicyEngine` before any channel adapter is contacted.
For OpenClaw-style lifecycle supervision, `buildCompanionGatewayLifecycleReport`
combines the companion gateway profile, inbox, draft/Fleet/reply state and
standard message outbox into one secret-safe report. Cowork renders the same
report as `Gateway lifecycle`, showing enabled/ready/attention counts, queued
work, reply drafts and outbox health without raw inbound text or credential
values.
`buildCompanionGatewayAdminPlan` adds the next supervised-ops layer: it turns
the lifecycle report and `.codebuddy/messages/outbox.jsonl` into a dry-run admin
plan with suggested channel start/stop/reconnect commands, queue/reply actions
and replayable delivery diagnostics. The plan deliberately sets
`executesChannelAdmin=false`, includes no raw message content, and Cowork renders
it as `Gateway admin` so operators can inspect the required actions before
running any live adapter or outbound delivery.
For live adapter control, `executeCompanionGatewayAdminAction` supports only
`enable`, `disable`, `start`, `stop`, and `reconnect`. It first verifies that the
requested action is present in the current admin plan, then requires
`approvedBy` plus `liveAdminConfirmed=true`, and finally appends a redacted
`.codebuddy/companion/gateway-admin.jsonl` execution record. Cowork exposes this
through `Execute` buttons on executable `Gateway admin` actions and prompts the
operator before the IPC call.

Validation:

```bash
npm test -- tests/companion-gateway.test.ts
cd cowork && npm test -- tests/hermes-surfaces-ipc.test.ts
cd cowork && npm test -- tests/companion-gateway-fleet-launch.test.ts
```

This is intentionally a supervised inbox and handoff flow, not an OpenClaw-style
unrestricted remote executor. Gateway replies are now explicit and policy-gated:
drafting proves review intent, while sending requires a separate approval and
uses the normal channel outbox path.

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
