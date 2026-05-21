# OpenClaw integration audit

Date: 2026-05-16

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
- The external OpenClaw Gateway is still out of the critical path. It is
  planned as an optional bridge for human channels such as Telegram,
  WhatsApp, Discord, iMessage and Slack.

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
| OpenClaw facade | `src/openclaw/index.ts` | Dormant facade | Exports six native modules and `initializeNativeEngineModules()`, but no production caller currently invokes the initializer. | Keep dormant until each module has an explicit architecture decision. Avoid one-shot activation. |
| Enterprise module bootstrap | `src/config/toml-config.ts`, `src/openclaw/index.ts` | Intentionally deferred | Config comments list 5/6 modules as deferred due conflicts: policy, hooks, compaction, retry, semantic memory. | Do not enable globally. Migrate one module at a time only after conflict analysis. |
| Plugin conflict detector | `src/plugins/conflict-detection.ts`, `src/plugins/plugin-manager.ts` | Active | `PluginManager.loadPlugin()` imports `getPluginConflictDetector()` and blocks conflicting plugins before registration. Covered by `tests/plugins/plugin-conflict-detector.test.ts`. | Keep. Useful safety win with low architectural risk. |
| Daily reset | `src/daemon/daily-reset.ts`, `src/agent/codebuddy-agent.ts`, `src/commands/handlers/daily-reset-handler.ts` | Active opt-in | Boot auto-starts when `[daily_reset].enabled=true`; slash handler can start/stop manually. | Keep as operational support for long-running autonomous sessions. |
| Team session | `src/collaboration/team-session.ts`, `src/agent/codebuddy-agent.ts`, `src/commands/handlers/team-session-handler.ts` | Active opt-in | Boot instantiates when `[team_session].enabled=true`; `/share` wires user-facing control. | Treat as local collaboration primitive. Do not confuse with Fleet peer RPC. |
| MultiAgentSystem | `src/agent/multi-agent/*`, `src/agent/codebuddy-agent.ts`, `src/commands/handlers/agents-handler.ts`, `src/commands/handlers/swarm-handler.ts` | Active opt-in | Boot can instantiate when `[multi_agent_system].enabled=true`; `/agents` and `/swarm` expose workflows. | Continue hardening around persistence, conflict resolution, cost caps and Fleet visibility. |
| Enhanced coordination | `src/agent/multi-agent/enhanced-coordination.ts`, `src/agent/multi-agent/session-registry.ts` | Active opt-in | Boot can instantiate coordination/session subsystems independently; sessions can attach Fleet bridge events. | Keep as internal multi-agent layer beneath Cowork/Fleet orchestration. |
| Peer RPC envelope | `src/server/websocket/peer-rpc.ts`, `src/fleet/fleet-listener.ts` | Active | `peer:request`/`peer:response` map mirrors OpenClaw `GatewayChannel.pending`; `peer.describe` mirrors OpenClaw `node.describe` with Code Buddy capabilities. | This is a core Code Buddy Fleet primitive. Continue testing it as first-class, not as OpenClaw compatibility glue. |
| Presence beacons | `src/fleet/heartbeat-broadcaster.ts` | Active | Heartbeat broadcaster explicitly follows OpenClaw `node.presence.alive` shape adapted to Code Buddy `fleet:*` events. | Keep. Cowork should surface stale/healthy peer state clearly. |
| Code Buddy Gateway | `src/gateway/server.ts`, `src/server/websocket/*`, `docs/fleet-guide.md` | Active | `docs/fleet-guide.md` documents Code Buddy Gateway as shipped AI-to-AI bus. | Remains the path for multi-LLM/multi-machine collaboration. |
| OpenClaw Gateway bridge | `docs/fleet-guide.md` | Planned / not coded | Guide says Phase `(e).7` is postponed and needs OpenClaw daemon installed. Planned `openclaw-node` bridge does not exist yet. | Implement only after Fleet/Cowork is stable and a local OpenClaw daemon is available. |
| ClawHub-like legacy registry | `src/skills-registry/index.ts` | Retired in this audit pass | It was an unused production surface backed by an in-memory `mockRegistry`; only its own test referenced it. | Use `src/skills/hub.ts` as the remaining marketplace/hub direction. |
| Skills Hub | `src/skills/hub.ts` | Partial real implementation | Uses HTTP fetch, local cache, lockfile, checksum, install/publish/sync. Inspired by ClawHub but Code Buddy-native. | Keep as the candidate real implementation. Add tests before routing user commands to it. |
| External channels | `src/channels/*` if present, OpenClaw Gateway plan | Mostly out of critical path | Current Fleet guide positions external channels as OpenClaw Gateway responsibility. | Do not build channels directly into Fleet unless the bridge plan changes. |

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
5. When ready for OpenClaw Gateway, build a narrow `openclaw-node`
   adapter:
   OpenClaw message in -> Cowork/Fleet dispatch -> Fleet result ->
   OpenClaw message out.

## Decision record

Code Buddy should absorb proven OpenClaw patterns, not become a fork of
OpenClaw. The architecture is clearer if:

- Code Buddy = brain, CLI, Fleet, Cowork, multi-LLM execution.
- OpenClaw = optional external-channel gateway.
- The bridge between both is explicit, small, observable and replaceable.
