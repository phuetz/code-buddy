# Application Validation Guide

This guide gives operators a public-safe way to validate the full Code Buddy
application: CLI, autonomous coding, Cowork, server API, Fleet, providers,
memory, tools, security, companion features, and documentation evidence.

It is not a marketing checklist. Each section includes commands or GUI paths
that produce observable pass/fail evidence.

## Safety Rules For Evidence

Before saving output or screenshots:

- use synthetic workspaces and prompts;
- avoid real customer repositories;
- redact emails, account ids, access tokens, absolute home paths and terminal
  history;
- do not publish raw provider logs;
- crop screenshots to the relevant panel;
- prefer test fixtures and public-safe markers.

Use this marker style for live-provider proof prompts:

```text
PUBLIC-PROOF-CODE-BUDDY-<feature-name>
```

## Baseline Build

Validate the root CLI and TypeScript project:

```bash
npm install
npm run typecheck
npm run lint
npm test -- tests/commands/autonomous-code-command.test.ts
```

Full validation remains:

```bash
npm run validate
```

That runs lint, typecheck and the full Vitest suite. Prefer targeted tests while
developing because the full suite is large.

## CLI And Session Flow

Basic help and one-shot run:

```bash
npx tsx src/index.ts --help
npx tsx src/index.ts --prompt "Summarize this repository in one paragraph" --output-format json
```

Session evidence:

```bash
buddy session list --limit 5
buddy session search "autonomous"
buddy --continue
```

Expected result: commands return structured session metadata and never print
provider secret values.

## Provider And Auth Flow

Provider auto-detection:

```bash
buddy doctor
buddy whoami
```

ChatGPT subscription route:

```bash
buddy login
buddy whoami
```

Expected result: connected state and plan are visible. Do not copy account email
or account id into public docs.

Model routing and fallback:

```bash
buddy --model gpt-5.6-sol --prompt "PUBLIC-PROOF-CODE-BUDDY-provider-route"
buddy --base-url http://localhost:11434/v1 --model llama3 --prompt "Say OK"
```

## Autonomous Coding

Contract-based run:

```bash
CODEBUDDY_RUNS_DIR=/tmp/codebuddy-runs \
  buddy autonomous-code --task-file task.json --json
```

Feature proof:

```bash
npm test -- \
  tests/agent/autonomous/agentic-coding-runner.test.ts \
  tests/agent/autonomous/checkpoint-resume.test.ts \
  tests/commands/autonomous-code-command.test.ts \
  tests/observability/run-store.test.ts
```

Expected result: `workflow-progress.json` and `agentic-coding-report.json`
artifacts exist in the run store. Cowork can read the same progress in
`Tests & executions -> Executions`.

See [Autonomous Coding And Cowork Progress](autonomous-coding-cowork-progress.md).

## Cowork Desktop

Build the renderer/electron test bundle:

```bash
cd cowork
npm run typecheck
npm run build:e2e
```

Run a GUI smoke:

```bash
npx playwright test e2e/cowork-smoke.spec.ts --reporter=list --workers=1
```

Run the autonomous progress proof:

```bash
npx playwright test e2e/test-runner-autonomous-progress.spec.ts --reporter=list
```

Expected result: the `Tests & executions` window opens, the Executions tab shows
an autonomous run card, and the public-safe screenshot is written to:

```text
docs/qa/code-buddy-studio/screenshots/110-test-runner-autonomous-progress.png
```

## HTTP Server

Start the local server:

```bash
buddy server --port 3000
```

Check health:

```bash
curl http://127.0.0.1:3000/api/health
curl "http://127.0.0.1:3000/api/daemon/status?format=report"
```

OpenAI-compatible chat smoke:

```bash
curl http://127.0.0.1:3000/api/chat/completions \
  -H "content-type: application/json" \
  -d '{"model":"gpt-5.6-sol","messages":[{"role":"user","content":"Say PUBLIC-PROOF-CODE-BUDDY-server"}]}'
```

In production, JWT is required. Do not publish bearer tokens.

## Fleet And Peer Work

Start one peer:

```bash
buddy server --port 3000
```

From another session:

```text
/fleet listen ws://127.0.0.1:3000 --api-key <redacted>
/fleet status --with-sessions
/fleet chat start local-peer --profile review
/fleet chat say PUBLIC-PROOF-CODE-BUDDY-fleet
```

Safe peer tool validation requires:

```bash
export CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT=/path/to/synthetic/workspace
export CODEBUDDY_PEER_TOOL_ALLOWLIST=view_file,list_directory,search
```

Expected result: read-only peer tools work inside the configured workspace and
fail closed when the workspace root is missing.

## Tools And Editing

Tool registry checks:

```bash
npm test -- tests/unit/registry.test.ts tests/unit/formal-tool-registry.test.ts
```

Editing guardrails:

```bash
npm test -- tests/unit/yolo-mode-fixes.test.ts tests/unit/security-sandbox.test.ts
```

Expected result: tool metadata stays valid, destructive commands are gated, and
write operations remain auditable.

## Memory, Lessons And Skills

Memory and lessons:

```text
/memory recent
/lessons list
/lessons search "verification"
```

ClawHub-style skill marketplace proof:

```bash
npm test -- tests/commands/native-engine-commands.test.ts tests/commands/skills-command-real.test.ts
```

Expected result: `buddy hub search|list|install|sync --json` stays
machine-readable, repository-backed taps can be added/refreshed through
`buddy hub tap ...`, `buddy hub well-known <url>` can discover
`/.well-known/skills/index.json`, and discovered `SKILL.md` content is cached so
`buddy hub install <name>` can install from the decentralized source without a
central registry.

Skills:

```bash
buddy skills list --json
buddy skills doctor --json
buddy skills usage --json
```

Expected result: skills and memory metadata are visible without dumping secret
values or full private transcript bodies.

## Companion, Voice And Camera

CLI readiness:

```bash
buddy companion status
buddy companion evaluate
buddy companion radar
buddy companion impulses
buddy companion safety recent
```

OpenClaw-style human channel inbox proof:

```bash
npm test -- tests/companion-gateway.test.ts
cd cowork && npm test -- tests/hermes-surfaces-ipc.test.ts
```

Expected result: accepted companion gateway messages create
`.codebuddy/companion/gateway-inbox.json` items with priority, proposed action,
redacted preview, `rawTextStored=false`, and `canAutoDispatch=false`.
Disabled channels create ignored inbox items and safety events instead of
silently disappearing. Cowork exposes the same queue in the Companion panel via
`companion.gateway.inbox` without storing raw message text or enabling
auto-dispatch. Preparing a queued item creates a local
`.codebuddy/companion/gateway-drafts/*.task.json` draft for
`buddy autonomous-code --require-approval`; it does not launch the run or send
an outbound channel reply. Routing that prepared task to Fleet writes a
`.fleet.json` handoff with `dispatchProfile=safe` and `privacyTag=sensitive`,
but does not call `fleet.dispatch`. Cowork can launch the handoff only after an
operator clicks `Launch Fleet` and confirms the native approval dialog; the
launch uses the central `fleet.dispatch` IPC path and still does not send an
outbound channel reply. After Fleet review, the operator can prepare a separate
`Reply draft`; it requires reviewer metadata, writes a `.reply.json` artifact
with `readyToSend=false`, stores only a redacted content preview, and does not
create a channel outbox entry. Sending that reviewed reply is a separate
operation: the operator provides the final text again, supplies `approvedBy`,
confirms live delivery, and the core routes through `executeSendMessage` so the
standard `.codebuddy/messages/outbox.jsonl` proof is written and live sends are
checked by `SendPolicyEngine`.
The companion lifecycle report then proves the gateway state across profile,
inbox, drafts, Fleet handoff, reply draft and outbox in one secret-safe payload;
Cowork renders that payload as `Gateway lifecycle` with ready/attention counts.
The companion admin plan extends that proof with dry-run channel operations and
replay diagnostics: it recommends start/stop/reconnect/review/replay actions,
summarizes `.codebuddy/messages/outbox.jsonl` by status, exposes only redacted
replay metadata, and marks `executesChannelAdmin=false` so validation can show
operator controls without triggering adapters or live sends.
When an operator explicitly executes `enable`, `disable`, `start`, `stop`, or
`reconnect`, the core requires `approvedBy` and `liveAdminConfirmed=true`,
checks the current admin plan, and writes
`.codebuddy/companion/gateway-admin.jsonl` with runtime-before/after status.
Cowork surfaces the same flow with `Execute` buttons and a `Gateway admin result`
link to the local audit log.

Camera is explicit opt-in:

```bash
buddy companion camera status
buddy companion camera snapshot
```

Expected result: snapshots and percepts are local artifacts. Review them before
sharing because camera frames can contain private visual data.

## Browser And Computer Use

Browser proof plan:

```bash
buddy tools browser-operator draft "PUBLIC-PROOF-CODE-BUDDY-browser" --json
```

Desktop automation proof:

```bash
CODEBUDDY_REAL_COMPUTER_USE=1 \
  cd cowork && npx playwright test e2e/test-runner-computer-use-real-suite.spec.ts --reporter=list
```

Expected result: read-only proof plans are safe to publish; real desktop
automation screenshots require manual review.

## Documentation And Screenshot Proof

Public screenshot index:

```text
docs/screenshots/README.md
docs/qa/code-buddy-studio/feature-qa.md
docs/qa/code-buddy-studio/overnight-qa-campaign.md
```

Current autonomous progress screenshot:

![Autonomous progress in Cowork](qa/code-buddy-studio/screenshots/110-test-runner-autonomous-progress.png)

Useful documentation entry points:

- [Getting Started](getting-started.md)
- [Commands](commands.md)
- [Cowork Desktop](cowork.md)
- [Fleet Guide](fleet-guide.md)
- [Providers](providers.md)
- [Tools Reference](tools-reference.md)
- [Security](security.md)
- [Agentic Coding Cell](agentic-coding-cell.md)
- [Autonomous Coding And Cowork Progress](autonomous-coding-cowork-progress.md)

## Latest Proof Bundle

Latest local proof in this branch: 2026-06-06, Europe/Paris.

Commands completed:

```bash
npm run typecheck
cd cowork && npm run typecheck
npm test -- \
  tests/agent/autonomous/agentic-coding-runner.test.ts \
  tests/agent/autonomous/checkpoint-resume.test.ts \
  tests/commands/autonomous-code-command.test.ts \
  tests/observability/run-store.test.ts
cd cowork && npm test -- tests/audit-bridge.test.ts tests/test-runner-panel-filters.test.ts
cd cowork && npm run lint
cd cowork && npm run build:e2e
cd cowork && npx playwright test e2e/test-runner-autonomous-progress.spec.ts --reporter=list
```

Observed result:

- root typecheck passed;
- Cowork typecheck passed;
- core focused autonomous/observability suite passed;
- Cowork focused audit/test-runner suite passed;
- Cowork lint passed with existing non-blocking warnings;
- Cowork E2E build passed;
- Playwright generated the autonomous progress screenshot.

Additional OpenClaw catch-up proof on 2026-06-07:

```bash
npm test -- tests/companion-gateway.test.ts
npm test -- tests/openclaw/gateway-bridge.test.ts
npm test -- tests/agent/hermes-claw-migrate-real.test.ts
cd cowork && npm test -- tests/hermes-openclaw-bridge.test.ts
cd cowork && npm test -- tests/hermes-surfaces-ipc.test.ts
cd cowork && npm test -- tests/companion-gateway-fleet-launch.test.ts
cd cowork && npm run typecheck
cd cowork && npm run build:e2e
cd cowork && npx playwright test e2e/companion-openclaw-bridge.spec.ts --reporter=list
npm run typecheck
```

The OpenClaw bridge test validates that `gateway.json` and `node.json`
discovery is secret-safe, the Code Buddy `openclaw-node` descriptor advertises
only local approval-based capabilities, inbound OpenClaw messages become
`dispatchProfile=safe` / `privacyTag=sensitive` Fleet handoff drafts, and
outbound replies remain dry-run previews until an operator approves a real send.
It also validates guarded daemon attach behavior: dry-run attach does not call
the transport, live attach is blocked without `liveAttachConfirmed=true`, and a
confirmed attach can send the bearer token to the transport while keeping the
result and `attach-log.jsonl` redacted. The same suite now validates guarded
OpenClaw response sends: dry-run sends do not contact the daemon, live sends are
blocked without `liveSendConfirmed=true`, and confirmed sends keep both response
content secrets and gateway tokens out of `send-log.jsonl`. It now also runs a
local HTTP OpenClaw daemon contract fixture for the live `nodes/register` and
`messages/reply` paths, proving URL resolution, bearer-token headers, JSON
payload shape, response summarization, and redacted logs without requiring a
private upstream OpenClaw install. The WebSocket contract proof also covers
`node.pair.list`, `node.pair.approve`, and `node.pair.reject`: pending pairing requests
are summarized with node id/display name only, and approval/rejection can send a
supplied pairing code in a confirmed live call while keeping that code, rejection
reason, gateway tokens, and daemon payload secrets out of stdout and
`ws-call-log.jsonl`.
The Hermes CLI migration suite also validates the user-facing bridge commands:
`buddy hermes claw bridge status --json`, `bridge probe-ws --json`,
`bridge call-ws logs.tail --json`, `bridge nodes-pending --json`,
`bridge node-approve --code ... --json`, `bridge node-reject --code ... --json`,
`bridge validate-upstream --json`, `bridge draft --json`, and
`bridge send --json` are machine-readable and keep tokens, pairing codes,
rejection reasons, and message secrets out of stdout. The WebSocket
probe/call/pairing/validation surfaces are dry-run by default; live network use
requires
`--apply --yes --approved-by <name>`.
The OpenClaw migration proof now also imports custom slash command Markdown
files from the source `commands` family into the real project command loader
path `.codebuddy/commands/*.md`; dry-run performs no writes, apply copies the
files, and existing commands are preserved unless `--overwrite` is supplied.

Observed result: `12` companion gateway tests, `22` OpenClaw bridge tests, `20`
Hermes/OpenClaw CLI migration tests, and `68` focused Cowork OpenClaw/gateway
surface tests passed, plus the targeted Cowork Playwright OpenClaw bridge proof
passed and wrote:

```text
docs/qa/code-buddy-studio/screenshots/111-companion-openclaw-bridge.png
```

These proofs cover local inbox creation, urgent message priority,
disabled-channel audit, token redaction, no auto-dispatch, confirmed admin
execution logging, dry-run OpenClaw compatibility handoffs, and guarded
OpenClaw daemon attach/response send, guarded Cowork node pairing, plus CLI
dry-run access. The OpenClaw
bridge suite now also includes a local WebSocket gateway fixture for the
documented `connect.challenge` -> signed `req(connect)` -> `res` -> `req(status)` -> `res` flow; the probe log
stores only frame types and response summaries, never tokens or raw payloads.
The `call-ws` proof mirrors OpenClaw's low-level `gateway call <method>` pattern:
it sends params only in a confirmed live call and records only method, param keys,
frame types and RPC success in `ws-call-log.jsonl`.
The node pairing proof mirrors OpenClaw's pending/approve/reject workflow
through `node.pair.list`, `node.pair.approve`, and `node.pair.reject`; it stores only
redacted request metadata and safe response summaries, never pairing codes,
rejection reasons, tokens, or raw daemon payloads.
The upstream validation proof adds `bridge validate-upstream`, a read-only
checklist that previews by default and, with explicit approval, verifies the
local `openclaw` CLI binary evidence, runs `openclaw gateway status --json` with
an allowlisted summary, and verifies discovery, WebSocket status probe, and
`node.pair.list` against a configured daemon while recording only redacted
summaries. `node.pair.list` is reported as scope-blocked when the paired OpenClaw
device lacks `operator.pairing`; the status handshake remains independently
validated.
The node-host discovery proof reads OpenClaw's documented `~/.openclaw/node.json`
shape, reports node id/display name/gateway host/port/capabilities, and keeps
the node pairing token out of CLI JSON and logs.
The new draft
proof verifies a `buddy autonomous-code
--require-approval` task file, `drafted` inbox transition, and safe/sensitive
Fleet handoff JSON without dispatch. The outbound reply proof verifies reviewer
metadata, redacted preview storage, `readyToSend=false`, and no outbound channel
reply. The send proof verifies live sends cannot run without explicit
confirmation and that approved replies use the standard channel outbox. The
gateway lifecycle proof verifies profile/inbox/draft/Fleet/reply/outbox counts
without leaking raw inbound text, reply text, tokens or passwords. The
Cowork IPC surface test passed for the read-only gateway inbox bridge, local
draft preparation, Fleet handoff preparation, outbound reply draft creation,
approved send execution, and lifecycle diagnostics from the active workspace.
The Cowork Fleet launch surface test passed for native confirmation plus
`fleet.dispatch(draft.dispatchInput)`, the `Reply draft` surface, and the
confirmed `Send reply` and `Gateway lifecycle` surfaces. The Cowork OpenClaw
bridge test passed for core-loader integration, secret-safe status, dry-run
attach/send previews, Fleet handoff drafts, guarded pending-node review,
guarded node approval/rejection, and live attach/send refusal unless the UI
supplies `approvedBy` plus `liveAttachConfirmed=true`,
`liveCallConfirmed=true` or `liveSendConfirmed=true`.
The Playwright screenshot proof opens the real Companion panel with synthetic
IPC data, verifies `OpenClaw bridge`, `detected`, local gateway endpoint,
token-present status and all eight bridge actions, then crops only that section
so no account, home path, repository path, prompt text, pairing code, rejection
reason or token is published.
