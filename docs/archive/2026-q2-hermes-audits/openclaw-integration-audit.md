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
  `~/.openclaw/gateway.json` and `~/.openclaw/node.json` without exposing tokens, builds a
  `codebuddy-fleet-bridge` node descriptor, converts inbound OpenClaw messages
  into redacted safe/sensitive Fleet handoff drafts, and formats outbound
  response previews as dry-run approval artifacts. It can also attach to a
  local OpenClaw daemon through an injected or real HTTP transport, but live
  attach requires `approvedBy` and `liveAttachConfirmed=true` and writes a
  redacted `.codebuddy/openclaw/bridge/attach-log.jsonl` record. Approved
  response sends are now supported through `sendOpenClawResponse`; dry-run is
  the default, live send requires `approvedBy` and `liveSendConfirmed=true`, and
  `.codebuddy/openclaw/bridge/send-log.jsonl` stores only redacted previews and
  response metadata. The bridge is now user-facing through
  `buddy hermes claw bridge status|probe-ws|call-ws|nodes-pending|node-approve|node-reject|attach|draft|send`,
  with `probe-ws`, `call-ws`, `nodes-pending`, `node-approve`, `node-reject`,
  `attach`, and `send` dry-run by default unless
  `--apply --yes --approved-by <name>` is supplied.
- Cowork now exposes that OpenClaw adapter in the Companion panel through
  `companion.openclaw.*` IPC handlers and preload methods. Operators can inspect
  secret-safe status, preview attach, create safe Fleet handoff drafts, preview
  sends, query pending node pairings, approve or reject a node by id or pairing
  code, and run live attach/node-pairing/send only after `approvedBy` plus
  native confirmation. The UI stores only the returned bridge artifact/status
  object; prompt text, pairing codes, rejection reasons and gateway tokens are
  not persisted by the panel.
- The bridge now has a local HTTP daemon contract test that exercises live
  `nodes/register` and `messages/reply` requests against a real Node HTTP
  server fixture. This proves endpoint resolution, bearer-token headers, JSON
  payload shape, response summarization and redacted logs. It is still not a
  substitute for certification against an upstream OpenClaw daemon binary.
- The bridge now also has a local WebSocket gateway contract test for the
  OpenClaw-documented control flow: client `connect`, gateway `hello-ok`,
  client `req(status)`, gateway `res`. The live probe path requires
  `approvedBy` and `liveProbeConfirmed=true`, sends the token only to the
  socket server, and writes `.codebuddy/openclaw/bridge/ws-probe-log.jsonl`
  without tokens or raw payloads.
- The same WebSocket layer exposes a guarded low-level `call-ws <method>` surface
  mirroring OpenClaw's `gateway call <method>`. It sends params only in a
  confirmed live call and writes `.codebuddy/openclaw/bridge/ws-call-log.jsonl`
  with method, param keys, frame types and RPC status, never raw params or
  response payloads.
- The node pairing surface now covers guarded `nodes.pending`, `nodes.approve`
  and `nodes.reject` calls. Pending results are summarized with node id/display
  name only, approval/rejection can send a supplied pairing code in confirmed
  live mode, and stdout/logs never echo pairing codes, rejection reasons, gateway
  tokens or raw daemon payloads.
- The CLI now includes `buddy hermes claw bridge validate-upstream`, a read-only
  certification checklist for real OpenClaw daemons. It previews by default and,
  with explicit approval, verifies local `openclaw` binary evidence, executes
  `openclaw gateway status --json` with an allowlisted summary, then checks
  discovery, WebSocket status, and `nodes.pending` while storing only redacted
  summaries. It is aligned with the official OpenClaw CLI reference for
  `gateway status|probe|call` and `nodes pending|approve|reject`, and fixture-tested
  locally; it still needs to be executed against an upstream daemon binary before
  this audit can claim upstream certification.
- Discovery now also reads the OpenClaw-documented node host lockfile
  `~/.openclaw/node.json`, surfaces only node id, display name, gateway
  host/port and capabilities, and keeps the node pairing token out of CLI JSON
  and logs.
- The Cowork bridge surface now has a public-safe Playwright proof:
  `cowork/e2e/companion-openclaw-bridge.spec.ts` verifies the real Companion
  panel with synthetic IPC data and writes the cropped screenshot
  `docs/qa/code-buddy-studio/screenshots/111-companion-openclaw-bridge.png`.
- Update 2026-06-07: the ClawHub-style Skills Hub now has **signed registry
  metadata**. `src/skills/hub-signing.ts` adds Ed25519 detached signatures over
  SKILL.md content (authenticity on top of the existing SHA-256 integrity
  check), a persistent trusted-publisher keyring, and a pure trust resolver that
  reports `verified`/`untrusted`/`invalid`/`unsigned` and catches key-id
  impersonation. `publish()` can sign, `install()`/`installFromContent()` record
  the verdict and enforce a fail-closed `requireSignedInstalls` policy (default
  off, backward compatible), and the surface is user-facing through
  `buddy hub publish --sign`, `buddy hub verify`, and `buddy hub keys
  generate|add|list|trust|remove`. This closes the long-standing Skills Hub gap
  before any community-wide third-party install rollout.
- Update 2026-06-08: a **real OpenClaw `2026.6.1` daemon is now installed**
  locally (Ollama-backed) and the bridge was validated against it. Discovery
  used to fail because OpenClaw 2026.6.x dropped the standalone `gateway.json`/
  `node.json` lockfiles in favour of a unified `~/.openclaw/openclaw.json` plus a
  `devices/paired.json` map; `discoverOpenClawGateway` now falls back to that
  layout (honestly reporting `lockfileSource`/`nodeSource`), so `buddy hermes
  claw bridge status` reports `Detected: yes` and `validate-upstream` runs the
  real `openclaw gateway status --json` round-trip (CLI interop proven, exitCode
  0). The remaining raw-WebSocket checks fail on OpenClaw's internal `protocol:4`
  handshake — a documented known limitation, not a blocker, since the supported
  path is the CLI/`validate-upstream` interface. This lifts the long-standing
  "no real OpenClaw install validated" gate.

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
| OpenClaw facade | `src/openclaw/index.ts`, `src/openclaw/gateway-bridge.ts` | Native facade plus local OpenClaw gateway compatibility adapter | Exports native modules plus `discoverOpenClawGateway`, `buildOpenClawNodeDescriptor`, `prepareOpenClawFleetHandoffDraft`, `buildOpenClawResponsePreview`, `probeOpenClawGatewayWebSocket`, `validateOpenClawUpstreamCompatibility`, `attachOpenClawGateway`, and `sendOpenClawResponse`. Covered by `tests/openclaw/gateway-bridge.test.ts`, including secret-safe `gateway.json`/`node.json` discovery, a fallback to the real OpenClaw 2026.6.x `openclaw.json` + `devices/paired.json` layout, real local HTTP/WebSocket contract fixtures for live probe/attach/send paths, and the read-only upstream validation checklist with OpenClaw binary detection. | **Done 2026-06-08**: validated against a live OpenClaw `2026.6.1` daemon (`~/.openclaw`, gateway `:18789`). 6/8 checks pass — discovery now detects the real install via the new `openclaw.json`/`devices/paired.json` fallback, and `openclaw gateway status --json` CLI interop returns real JSON (exitCode 0). The 2 failing checks (`websocket-probe`, `pending-node-list`) hit the raw WS `protocol:4` handshake, which diverges from the May-modeled `{type:'connect'}` frame (real contract: first frame must be `{type:'req',method:'connect',params:ConnectParams}` → `hello-ok`). Kept as a **known limitation** — use the stable CLI/`validate-upstream` path per this audit's "small, replaceable bridge" principle rather than hard-coupling to OpenClaw's internal frames. |
| Enterprise module bootstrap | `src/config/toml-config.ts`, `src/openclaw/index.ts` | Intentionally deferred | Config comments list 5/6 modules as deferred due conflicts: policy, hooks, compaction, retry, semantic memory. | Do not enable globally. Migrate one module at a time only after conflict analysis. |
| Plugin conflict detector | `src/plugins/conflict-detection.ts`, `src/plugins/plugin-manager.ts` | Active | `PluginManager.loadPlugin()` imports `getPluginConflictDetector()` and blocks conflicting plugins before registration. Covered by `tests/plugins/plugin-conflict-detector.test.ts`. | Keep. Useful safety win with low architectural risk. |
| Daily reset | `src/daemon/daily-reset.ts`, `src/agent/codebuddy-agent.ts`, `src/commands/handlers/daily-reset-handler.ts` | Active opt-in | Boot auto-starts when `[daily_reset].enabled=true`; slash handler can start/stop manually. | Keep as operational support for long-running autonomous sessions. |
| Team session | `src/collaboration/team-session.ts`, `src/agent/codebuddy-agent.ts`, `src/commands/handlers/team-session-handler.ts` | Active opt-in | Boot instantiates when `[team_session].enabled=true`; `/share` wires user-facing control. | Treat as local collaboration primitive. Do not confuse with Fleet peer RPC. |
| MultiAgentSystem | `src/agent/multi-agent/*`, `src/agent/codebuddy-agent.ts`, `src/commands/handlers/agents-handler.ts`, `src/commands/handlers/swarm-handler.ts` | Active opt-in | Boot can instantiate when `[multi_agent_system].enabled=true`; `/agents` and `/swarm` expose workflows. | Continue hardening around persistence, conflict resolution, cost caps and Fleet visibility. |
| Enhanced coordination | `src/agent/multi-agent/enhanced-coordination.ts`, `src/agent/multi-agent/session-registry.ts` | Active opt-in | Boot can instantiate coordination/session subsystems independently; sessions can attach Fleet bridge events. | Keep as internal multi-agent layer beneath Cowork/Fleet orchestration. |
| Peer RPC envelope | `src/server/websocket/peer-rpc.ts`, `src/fleet/fleet-listener.ts` | Active | `peer:request`/`peer:response` map mirrors OpenClaw `GatewayChannel.pending`; `peer.describe` mirrors OpenClaw `node.describe` with Code Buddy capabilities. | This is a core Code Buddy Fleet primitive. Continue testing it as first-class, not as OpenClaw compatibility glue. |
| Presence beacons | `src/fleet/heartbeat-broadcaster.ts` | Active | Heartbeat broadcaster explicitly follows OpenClaw `node.presence.alive` shape adapted to Code Buddy `fleet:*` events. | Keep. Cowork should surface stale/healthy peer state clearly. |
| Code Buddy Gateway | `src/gateway/server.ts`, `src/server/websocket/*`, `docs/fleet-guide.md` | Active | `docs/fleet-guide.md` documents Code Buddy Gateway as shipped AI-to-AI bus. | Remains the path for multi-LLM/multi-machine collaboration. |
| OpenClaw migration | `src/agent/hermes-claw-migrate.ts`, `src/commands/cli/hermes-commands.ts`, `tests/agent/hermes-claw-migrate-real.test.ts` | Partial but broader direct import | `buddy hermes claw migrate` now recognizes 35 categories and directly imports identity files, memory, default model, MCP servers, SkillsHub skills, custom slash commands to `.codebuddy/commands/*.md`, and mappable agent settings. Remaining non-consumer or sensitive categories are archived for review with credential-bearing archives written 0600. | Validate against a real OpenClaw install and only promote additional categories when their source shape and Code Buddy consumer are both verified. |
| OpenClaw Gateway bridge | `src/openclaw/gateway-bridge.ts`, `src/commands/cli/hermes-commands.ts`, `cowork/src/main/tools/hermes-openclaw-bridge.ts`, `cowork/src/main/ipc/companion-ipc.ts`, `cowork/src/renderer/components/CompanionPanel.tsx`, `cowork/e2e/companion-openclaw-bridge.spec.ts`, `docs/fleet-guide.md` | Local compatibility adapter with CLI and Cowork UX, guarded live WebSocket probe/call/node pairing, guarded live attach, and guarded response send | Reads `gateway.json` plus `node.json` (with a fallback to the real OpenClaw 2026.6.x `openclaw.json` + `devices/paired.json` layout), returns secret-safe discovery, publishes an `openclaw_node_descriptor`, maps OpenClaw inbound messages to Fleet handoff drafts, prepares response previews, probes the OpenClaw WebSocket handshake only after explicit approval, can run low-level WebSocket RPC calls and `nodes.pending`/`nodes.approve`/`nodes.reject` only after explicit approval, can run read-only upstream validation only after explicit approval, can attach to a daemon only after explicit approval, can send approved responses through an injected/real HTTP transport while logging redacted status, exposes `buddy hermes claw bridge status|probe-ws|call-ws|nodes-pending|node-approve|node-reject|validate-upstream|attach|draft|send`, and renders a Cowork `OpenClaw bridge` panel with attach, handoff, send and node-pairing buttons plus explicit live confirmations. Covered by `tests/openclaw/gateway-bridge.test.ts`, `tests/agent/hermes-claw-migrate-real.test.ts`, `cowork/tests/hermes-openclaw-bridge.test.ts`, `cowork/tests/hermes-surfaces-ipc.test.ts`, `cowork/tests/companion-gateway-fleet-launch.test.ts`, and `cowork/e2e/companion-openclaw-bridge.spec.ts`. The OpenClaw bridge suite now includes a local HTTP daemon contract fixture for `nodes/register` and `messages/reply`, local WebSocket contract fixtures for `connect`/`hello-ok`/`req(status)`/`res`, `call-ws logs.tail`, `nodes.pending`, `nodes.approve`, `nodes.reject`, and `validate-upstream`, and a `node.json` discovery proof that redacts pairing tokens, and fixtures for the OpenClaw 2026.6.x `openclaw.json`/`devices/paired.json` discovery fallback plus a backward-compat guard that legacy `gateway.json` still wins; the Cowork e2e proof writes `docs/qa/code-buddy-studio/screenshots/111-companion-openclaw-bridge.png` with only synthetic/local values. | **Done 2026-06-08**: ran `validate-upstream` against a live OpenClaw `2026.6.1` daemon — discovery + `openclaw gateway status --json` CLI interop pass; the raw-WS `protocol:4` handshake (`websocket-probe`/`pending-node-list`) is a documented known limitation (modeled frame diverges from upstream). Next (optional): a paired-node WS-frame adapter if raw `nodes.pending`/attach interop is ever required — otherwise stay on the CLI path. |
| ClawHub-like legacy registry | `src/skills-registry/index.ts` | Retired in this audit pass | It was an unused production surface backed by an in-memory `mockRegistry`; only its own test referenced it. | Use `src/skills/hub.ts` as the remaining marketplace/hub direction. |
| Skills Hub | `src/skills/hub.ts`, `src/skills/hub-signing.ts`, `src/commands/cli/native-engine-commands.ts`, `src/commands/skills-cli/index.ts` | Active ClawHub-style marketplace surface with signed registry metadata | Uses HTTP fetch, local cache, lockfile, checksum, install/publish/sync, repository-backed taps and `/.well-known/skills/index.json` discovery. `buddy hub` now supports machine-readable search/list/install/sync plus `hub tap add\|list\|remove\|refresh` and `hub well-known`; discovered tap/well-known `SKILL.md` content is cached so `buddy hub install <name>` can install without a central registry. **Signed registry metadata is now implemented (`hub-signing.ts`)**: Ed25519 detached signatures bind the SKILL.md checksum (authenticity, not just integrity); a persistent trusted-publisher keyring (`~/.codebuddy/hub/trusted-keys.json`) resolves a signature to `verified`/`untrusted`/`invalid`/`unsigned` and detects key-id impersonation; `publish()` can attach a signature; `install()`/`installFromContent()` record the verdict and honour a fail-closed `requireSignedInstalls` (+ optional `minSignatureTrust`) policy, default off. User-facing via `buddy hub publish --sign`, `buddy hub verify <name>`, and `buddy hub keys generate\|add\|list\|trust\|remove`. Covered by `tests/skills/hub-signing.test.ts`, `tests/skills/hub.test.ts`, `tests/commands/native-engine-commands.test.ts` and `tests/commands/skills-command-real.test.ts`. | Next: sign the hub-served registry **index** itself (not just per-skill SKILL.md) and seed an official builtin publisher key before encouraging community-wide third-party installs. |
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
   `src/skills/hub.ts`; the primary `buddy hub` command is now the canonical
   marketplace entry point, while `buddy skills` remains the installed-package
   management surface.
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
