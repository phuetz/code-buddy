# Cowork competitor parity audit

Date: 2026-05-18
Workspace: `<code-buddy repo root>`

## Scope

This audit compares Code Buddy + Cowork against the product shape Patrice
named: Claude/Cowork-style desktop workbench, Codex on Windows, Hermes
Agent and Manus-style browser operator flows.

The goal is not to clone any competitor. The goal is to identify the
missing product loops that would make Code Buddy feel like one coherent
agent workbench across CLI, Cowork and Fleet.

## Sources checked

- Hermes Agent docs: `https://hermes-agent.nousresearch.com/docs/`
- Hermes Agent GitHub README:
  `https://github.com/NousResearch/hermes-agent/blob/main/README.md`
- Claude Code subagents:
  `https://code.claude.com/docs/en/sub-agents`
- Claude Agent SDK overview:
  `https://code.claude.com/docs/en/agent-sdk/overview`
- Manus Browser Operator:
  `https://manus.im/docs/features/browser-operator`
- OpenAI Codex CLI:
  `https://developers.openai.com/codex/cli`
- Codex with ChatGPT plan / remote controls:
  `https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan`
- Codex use cases:
  `https://developers.openai.com/codex/use-cases`

## Competitor signals

### Hermes Agent

Hermes is the strongest benchmark for durable agent operating-system
behavior. The public docs emphasize a closed learning loop, autonomous
skill creation, skill improvement, FTS-style cross-session recall,
scheduled automations, multi-platform gateway channels, MCP, web/browser
control and isolated subagents. The key lesson for Code Buddy is:
memory, skills, schedules and runs must be connected into one visible
loop.

### Claude Code / Claude Cowork style

Claude Code's strongest transferable signal is configuration as durable
files: skills, slash commands, memory, plugins and subagents. Custom
subagents expose explicit tool lists, disallowed tools, model,
permission mode, MCP servers, hooks, max turns, skills, memory,
background and isolation. The key lesson for Code Buddy is: agent
profiles should be inspectable, portable and enforceable, not only
prompt text.

### OpenAI Codex / Codex Windows

Codex's strongest product signal is a controlled local agent that can
read, edit and run code in a selected directory, with native Windows
support, approvals, subagents, web search, scripting, MCP and cloud
task handoff. The ChatGPT plan docs also show the enterprise side:
workspace controls, app/plugin controls, RBAC and remote control
permissions. The key lesson for Code Buddy is: Windows-first local
power plus remote supervision needs a clear control plane and audit
trail.

### Manus

Manus' Browser Operator is the best benchmark for web action UX:
explicit browser connection, operator permission, local logged-in tabs
when appropriate, isolated cloud browser for broader research, a
dedicated tab for autonomous work, stop control and action logs. The key
lesson for Code Buddy is: internet automation should be evidence-first,
permissioned and visible as steps/artifacts, not hidden as an opaque
script.

## Current Code Buddy strengths

- Windows-first CLI and Cowork workflow.
- Native TypeScript/React stack with a real desktop cockpit.
- Fleet dispatch profiles and Hermes-style toolset descriptors.
- Fleet sagas, Activity Feed, scheduled work strips and outcome reuse.
- Lessons graph and Obsidian-style vault export.
- Research script artifact envelope plus local materialization/runner.
- Lead discovery workflow template with public-data and review-only
  guardrails.
- Run search and recall packs that can include runs, artifacts,
  lessons, memories and sessions.
- Built-in Hermes custom agent profile plus CLI diagnostics.
- Browser proof posture: search, fetch, observe, extract, assert.

## Biggest missing loops

| Gap | Why competitors feel stronger | Code Buddy status | Priority |
| --- | --- | --- | --- |
| One visible work queue | Hermes/Codex make long work trackable beyond chat | Fleet sagas exist, but not every run enters one work queue | P0 |
| Inspectable handoff | Codex/Manus make continuation obvious | Recall packs exist; Cowork handoff was copy-only | P0 |
| Enforced profile contracts | Claude subagents expose tools/permissions/isolation | Profile inspection exists; full schema patch/enforcement still partial | P0 |
| Browser operator consent | Manus separates local logged-in browser from sandbox cloud work | Browser proof tools exist; consent/session UX is not complete | P1 |
| Durable artifacts index | Hermes/Codex recall task evidence across sessions | Run/artifact FTS exists; historical backfill now has a CLI surface | P1 |
| Hook lifecycle | Claude/Hermes let teams wire guardrails without editing core | Policy resolver exists; generic hooks are still missing | P1 |
| Remote supervision | Hermes gateway and Codex remote control support supervision away from the laptop | Fleet/Cowork local first; mobile-safe gateway is still a plan | P1 |
| Skill lifecycle UI | Hermes/Claude make skills visible and portable | Skills/lessons exist; Cowork package manager is missing | P2 |
| Eval/trajectory loop | Codex and Hermes treat runs as reusable evidence | Tests exist; golden workflow evals and trajectory exports are missing | P2 |
| Enterprise controls | Codex docs surface RBAC/app/plugin controls | Local policies exist; admin-level audit/redaction UX is not complete | P2 |

## Product target

Code Buddy should become:

- CLI: scriptable execution, stable JSON, smokeable commands.
- Cowork: visible cockpit for plans, work queues, approvals,
  artifacts, memory and lessons.
- Fleet: multi-agent dispatch with enforceable profile/tool boundaries.
- Lessons: procedural memory that can be reviewed, linked and reused.
- Browser/research: permissioned proof loops with public-data evidence.
- Remote: supervision and approval from phone before broad messaging.

## Completed in this audit pass

- The Audit Log recall pack now has a second action: "Send to Fleet".
- The action builds the same recall pack envelope as copy-to-clipboard.
- It opens Fleet Command Center with a prefilled research/public draft
  goal.
- It does not dispatch, schedule, send email or contact anyone.
- The draft includes an explicit outreach-disabled guardrail.
- Run artifacts now have a durable local SQLite FTS5 index on save.
- `RunStore.searchRuns()` queries that artifact index before falling
  back to the existing file scan, so newly generated plans, summaries
  and scripts stay searchable across store restarts.

## Revised next TODOs

1. Make every long-running CLI/Cowork action create or link an
   `AgentRun` and visible work item.
2. Add artifact-index health/repair reporting for stale or moved run folders.
3. Finish dynamic schema patching so disabled tools disappear from
   model-facing schemas.
4. Add a Cowork profile permission inspector for the exact next run,
   including write/network/browser consent.
5. Add Browser Operator mode: local browser consent, dedicated tab,
   visible action log, stop button and proof artifact export.
6. Add mobile-safe remote supervision: list runs, open artifacts,
   approve/cancel, send prompt, no secret-heavy payloads.
7. Add hook lifecycle: before tool call, after tool call, before memory
   write, after run complete and before delivery.
8. Add skill package manager in Cowork: browse, enable, disable,
   inspect telemetry, install only after review.
9. Add trajectory export with privacy redaction for debugging/evals.
10. Add golden workflow evals for lead discovery, code fix, doc
    workshop, Fleet review and scheduled run.
