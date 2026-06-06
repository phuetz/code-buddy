# OpenClaw integration audit

Date: 2026-05-16, updated 2026-06-07

Scope: current Code Buddy worktree after the weekend Fleet/Cowork work.
This file updates the older Claude audit in
`D:\CascadeProjects\claude-et-patrice\propositions\AUDIT-OPENCLAW-HERITAGE-2026-05-02.md`.

## Executive summary

OpenClaw is not vendored as a full upstream source tree inside Code
Buddy. The current integration is selective:

- Code Buddy keeps its own gateway, Fleet bus, Cowork cockpit, provider
  routing, plugin system and multi-agent runtime.
- OpenClaw was used as an audit/reference source for useful patterns:
  presence beacons, request/response correlation, node capability
  discovery, skills hub ideas, session/collaboration modules and
  channel gateway separation.
- The `src/openclaw/index.ts` module is an export facade over native
  Code Buddy modules, not a full OpenClaw runtime.
- The external OpenClaw Gateway is still out of the critical path. Code
  Buddy now has a local compatibility adapter for the `openclaw-node`
  contract, but it deliberately prepares local drafts instead of attaching
  to a live OpenClaw daemon or sending channel replies implicitly.
- Update 2026-06-07: Code Buddy now has a native companion gateway
  inbox for accepted or rejected human-channel messages. Inbound
  Telegram/Discord/Slack/etc. companion messages can be recorded as a
  local review queue item with priority, proposed action, redacted
  preview, and `canAutoDispatch=false`, giving Code Buddy the first
  OpenClaw-style "agent OS inbox" loop without enabling unsafe remote
  action.
- Cowork now renders that native gateway inbox in the Companion panel
  through a read-only IPC bridge, so operators can see queued/ignored
  counts, priority, channel, redacted preview and proposed action before
  approving any follow-up work.
- The Companion panel can now prepare a local `autonomous-code` task
  draft from a queued inbox item. The generated command includes
  `--require-approval`, the draft stores only the redacted preview, and
  no Fleet dispatch or outbound channel send is performed automatically.
- A prepared gateway task can now be converted into a safe Fleet handoff
  JSON with `dispatchProfile=safe` and `privacyTag=sensitive`; this
  still does not call `fleet.dispatch` or reply on the external channel.
- Cowork can launch that Fleet handoff only through an explicit
  operator click plus native confirmation dialog. The launch reuses the
  centralized `fleet.dispatch` IPC path, so privacy lint, cost checks,
  routing and SagaRunner remain the single execution path.
- After Fleet review, Cowork can prepare a separate gateway reply draft.
  It requires reviewer metadata, stores only a redacted content preview,
  writes a `.reply.json` artifact with `readyToSend=false`, and still
  does not create a channel outbox entry or silently reply externally.
- The final gateway reply send is now a separate explicit operation.
  Cowork asks for the final text again, requires `approvedBy`, shows a
  native confirmation before live delivery, and calls the core
  `sendCompanionGatewayOutboundReply` path. The core delegates to
  `executeSendMessage`, writes `.codebuddy/messages/outbox.jsonl`, and
  uses `SendPolicyEngine` for live sends.
- A companion gateway lifecycle report now aggregates profile state,
  per-channel readiness, inbox queues, local task drafts, Fleet handoffs,
  reviewed reply drafts and outbox results without exposing raw message
  content. Cowork renders it as `Gateway lifecycle`, giving operators the
  OpenClaw-style health/lifecycle cockpit that was previously missing.
- A companion gateway admin plan now derives dry-run channel actions and
  replayable delivery diagnostics from the lifecycle report and standard
  outbox. Cowork renders it as `Gateway admin`; the payload includes suggested
  start/stop/reconnect/review/replay actions but sets
  `executesChannelAdmin=false`, so it is evidence and operator guidance rather
  than a hidden live-control path.
- Confirmed gateway admin execution now covers the live-control subset:
  `enable`, `disable`, `start`, `stop`, and `reconnect`. The core verifies the
  action against the current plan, requires `approvedBy` and
  `liveAdminConfirmed=true`, then writes
  `.codebuddy/companion/gateway-admin.jsonl` with redacted runtime-before/after
  status. Cowork exposes this through `Execute` buttons and a visible
  `Gateway admin result` audit link.
- OpenClaw adapter compatibility now exists in
  `src/openclaw/gateway-bridge.ts`. It discovers
  `~/.openclaw/gateway.json` without exposing tokens, builds a
  `codebuddy-fleet-bridge` node descriptor, converts inbound OpenClaw messages
  into redacted safe/sensitive Fleet handoff drafts, and formats outbound
  response previews as dry-run approval artifacts. It can also attach to a
  local OpenClaw daemon through an injected or real HTTP transport, but live
  attach requires `approvedBy` and `liveAttachConfirmed=true` and writes a
  redacted `.codebuddy/openclaw/bridge/attach-log.jsonl` record.

Strategic conclusion: keep Code Buddy Gateway as the AI-to-AI brain.
Use OpenClaw later as an add-on gateway for external human channels,
not as a replacement for the Code Buddy Fleet architecture.

Follow-up benchmark: `docs/hermes-agent-strategy.md` now treats Hermes
Agent as the stronger primary reference for durable agent OS patterns.
OpenClaw remains useful context, but it is no longer the main benchmark
for Code Buddy's next architecture moves.

## Status matrix

| Area | Files | Current status | Evidence | Next action |
|---|---|---:|---|---|
| OpenClaw facade | `src/openclaw/index.ts`, `src/openclaw/gateway-bridge.ts` | Native facade plus local OpenClaw gateway compatibility adapter | Exports native modules plus `discoverOpenClawGateway`, `buildOpenClawNodeDescriptor`, `prepareOpenClawFleetHandoffDraft`, `buildOpenClawResponsePreview`, and `attachOpenClawGateway`. Covered by `tests/openclaw/gateway-bridge.test.ts`. | Keep outbound OpenClaw sends preview-only until live send semantics are explicitly confirmed. |
| Enterprise module bootstrap | `src/config/toml-config.ts`, `src/openclaw/index.ts` | Intentionally deferred | Config comments list 5/6 modules as deferred due conflicts: policy, hooks, compaction, retry, semantic memory. | Do not enable globally. Migrate one module at a time only after conflict analysis. |
| Plugin conflict detector | `src/plugins/conflict-detection.ts`, `src/plugins/plugin-manager.ts` | Active | `PluginManager.loadPlugin()` imports `getPluginConflictDetector()` and blocks conflicting plugins before registration. Covered by `tests/plugins/plugin-conflict-detector.test.ts`. | Keep. Useful safety win with low architectural risk. |
| Daily reset | `src/daemon/daily-reset.ts`, `src/agent/codebuddy-agent.ts`, `src/commands/handlers/daily-reset-handler.ts` | Active opt-in | Boot auto-starts when `[daily_reset].enabled=true`; slash handler can start/stop manually. | Keep as operational support for long-running autonomous sessions. |
| Team session | `src/collaboration/team-session.ts`, `src/agent/codebuddy-agent.ts`, `src/commands/handlers/team-session-handler.ts` | Active opt-in | Boot instantiates when `[team_session].enabled=true`; `/share` wires user-facing control. | Treat as local collaboration primitive. Do not confuse with Fleet peer RPC. |
| MultiAgentSystem | `src/agent/multi-agent/*`, `src/agent/codebuddy-agent.ts`, `src/commands/handlers/agents-handler.ts`, `src/commands/handlers/swarm-handler.ts` | Active opt-in | Boot can instantiate when `[multi_agent_system].enabled=true`; `/agents` and `/swarm` expose workflows. | Continue hardening around persistence, conflict resolution, cost caps and Fleet visibility. |
| Enhanced coordination | `src/agent/multi-agent/enhanced-coordination.ts`, `src/agent/multi-agent/session-registry.ts` | Active opt-in | Boot can instantiate coordination/session subsystems independently; sessions can attach Fleet bridge events. | Keep as internal multi-agent layer beneath Cowork/Fleet orchestration. |
| Peer RPC envelope | `src/server/websocket/peer-rpc.ts`, `src/fleet/fleet-listener.ts` | Active | `peer:request`/`peer:response` map mirrors OpenClaw `GatewayChannel.pending`; `peer.describe` mirrors OpenClaw `node.describe` with Code Buddy capabilities. | This is a core Code Buddy Fleet primitive. Continue testing it as first-class, not as OpenClaw compatibility glue. |
| Presence beacons | `src/fleet/heartbeat-broadcaster.ts` | Active | Heartbeat broadcaster explicitly follows OpenClaw `node.presence.alive` shape adapted to Code Buddy `fleet:*` events. | Keep. Cowork should surface stale/healthy peer state clearly. |
| Code Buddy Gateway | `src/gateway/server.ts`, `src/server/websocket/*`, `docs/fleet-guide.md` | Active | `docs/fleet-guide.md` documents Code Buddy Gateway as shipped AI-to-AI bus. | Remains the path for multi-LLM/multi-machine collaboration. |
| OpenClaw Gateway bridge | `src/openclaw/gateway-bridge.ts`, `docs/fleet-guide.md` | Local compatibility adapter with guarded live attach | Reads `gateway.json`, returns secret-safe discovery, publishes an `openclaw_node_descriptor`, maps OpenClaw inbound messages to Fleet handoff drafts, prepares response previews, and can attach to a daemon only after explicit approval while logging redacted status. | Next: validate against a real OpenClaw daemon and add approved live response send only after endpoint semantics are verified. |
| ClawHub-like legacy registry | `src/skills-registry/index.ts` | Retired in this audit pass | It was an unused production surface backed by an in-memory `mockRegistry`; only its own test referenced it. | Use `src/skills/hub.ts` as the remaining marketplace/hub direction. |
| Skills Hub | `src/skills/hub.ts` | Partial real implementation | Uses HTTP fetch, local cache, lockfile, checksum, install/publish/sync. Inspired by ClawHub but Code Buddy-native. | Keep as the candidate real implementation. Add tests before routing user commands to it. |
| External channels | `src/channels/*`, `src/companion/gateway.ts`, `src/companion/gateway-inbox.ts`, `cowork/src/main/ipc/companion-ipc.ts`, `cowork/src/renderer/components/CompanionPanel.tsx` | Native supervised inbox with Cowork draft, Fleet handoff, approved launch, reply draft, explicit send, lifecycle diagnostics, dry-run admin plan and confirmed admin execution | Channel adapters are broad; companion gateway messages now create local review-queue items with redacted previews, priority, proposed action and `canAutoDispatch=false`. Cowork reads the inbox through `companion.gateway.inbox`, prepares draft-only `buddy autonomous-code --require-approval` tasks via `companion.gateway.draft`, writes safe/sensitive Fleet handoff JSON via `companion.gateway.fleetDraft`, can launch the handoff only through a confirmed `fleet.dispatch` call, can prepare a reviewed `.reply.json` draft with `readyToSend=false`, can send only through a separate confirmed `executeSendMessage`/outbox path, renders a `companion_gateway_lifecycle` report with per-channel ready/attention counts, renders a `companion_gateway_admin_plan` with start/stop/reconnect/review/replay guidance plus redacted outbox diagnostics, and can execute the live-control subset only after explicit approval while writing `.codebuddy/companion/gateway-admin.jsonl`. Covered by `tests/companion-gateway.test.ts`, `cowork/tests/hermes-surfaces-ipc.test.ts`, and `cowork/tests/companion-gateway-fleet-launch.test.ts`. | Next: broader e2e screenshots and optional live OpenClaw daemon attach. |

## What Claude likely did

Claude appears to have done three different things under the name
"OpenClaw integration":

1. Audited dormant Code Buddy modules that looked inherited or inspired
   by OpenClaw.
2. Woke several safe, useful modules through TOML flags and slash
   commands: daily reset, team session, multi-agent system and plugin
   conflict detection.
3. Imported architectural patterns into Fleet: request/response
   correlation, capability discovery, presence beacons and role/depth
   guards.

That is useful work, but it explains why it felt hard to follow: some
changes were product features, some were architecture alignments, and
some were only future bridge notes.

## Main risks

- `initializeNativeEngineModules()` can be tempting because it wakes a
  bundle at once, but the config comments already identify real
  conflicts with active Code Buddy systems. Global activation would be
  risky.
- There used to be two skills surfaces. The mock-backed
  `src/skills-registry/index.ts` has been retired; `src/skills/hub.ts`
  is now the remaining marketplace/hub direction.
- The phrase "OpenClaw Gateway" can obscure the current architecture:
  Code Buddy Gateway is already real and shipped; OpenClaw Gateway is a
  future external-channel bridge.
- Some comments still describe old "inert" status even though related
  modules have since been wired. Future audits should rely on current
  callers, not only on older prose.

## Recommended next steps

1. Keep OpenClaw Gateway out of the critical path until Cowork Fleet
   dispatch, saga tracking and peer capability UI are comfortable.
2. Consolidate any future skills marketplace work around
   `src/skills/hub.ts`.
3. Add a small automated audit/check that fails if
   `initializeNativeEngineModules()` becomes called without explicit
   per-module tests.
4. Continue hardening Code Buddy Fleet as the main robot brain:
   `peer.describe`, routing, `peer.dispatch`, saga outcomes and Cowork
   visibility.
5. Harden per-channel admin actions: start/stop/reconnect controls,
   replayable delivery diagnostics and optional OpenClaw adapter compatibility.
6. When ready for OpenClaw Gateway, build a narrow `openclaw-node`
   adapter:
   OpenClaw message in -> Cowork/Fleet dispatch -> Fleet result ->
   OpenClaw message out.

## Decision record

Code Buddy should absorb proven OpenClaw patterns, not become a fork of
OpenClaw. The architecture is clearer if:

- Code Buddy = brain, CLI, Fleet, Cowork, multi-LLM execution.
- OpenClaw = optional external-channel gateway.
- The bridge between both is explicit, small, observable and replaceable.
