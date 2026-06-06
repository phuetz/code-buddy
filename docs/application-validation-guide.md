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
buddy --model gpt-5.5 --prompt "PUBLIC-PROOF-CODE-BUDDY-provider-route"
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
  -d '{"model":"gpt-5.5","messages":[{"role":"user","content":"Say PUBLIC-PROOF-CODE-BUDDY-server"}]}'
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
an outbound channel reply.

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
cd cowork && npm test -- tests/hermes-surfaces-ipc.test.ts
npm run typecheck
```

Observed result: `5` companion gateway tests passed, including local inbox
creation, urgent message priority, disabled-channel audit, token redaction and
no auto-dispatch. The new draft proof verifies a `buddy autonomous-code
--require-approval` task file and `drafted` inbox transition. The Cowork IPC
surface test passed for both the read-only gateway inbox bridge and draft
preparation from the active workspace.
