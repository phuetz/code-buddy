# Hermes Agent official parity audit

Date: 2026-05-30

Verdict: **Code Buddy is not feature-for-feature equivalent to official
Hermes Agent.** Code Buddy has substantial Hermes-inspired coverage, and in
some areas it has different or broader Code Buddy/Cowork/Fleet primitives, but
the full official Hermes surface is not present as an integral drop-in parity
set.

This audit checks the official NousResearch source and docs against the current
Code Buddy tree. It should be treated as the current boundary before adding new
Hermes-parity work.

## Official source window

- Official repo: <https://github.com/NousResearch/hermes-agent>
- Official docs: <https://hermes-agent.nousresearch.com/docs/>
- Local official mirror inspected at `D:/CascadeProjects/_external/hermes-agent`.
- Fetched upstream commit: `61268ff7 feat(cli): add hermes prompt-size diagnostic (#35276)`.
- Latest tag observed locally: `v2026.5.29.2`.
- Note: `pyproject.toml` on `origin/main` still reports `0.15.1`; this audit keys
  off the inspected commit and docs, not the package version string.

Official docs reviewed:

- CLI reference: <https://hermes-agent.nousresearch.com/docs/reference/cli-commands>
- Built-in tools: <https://hermes-agent.nousresearch.com/docs/reference/tools-reference>
- Toolsets: <https://hermes-agent.nousresearch.com/docs/reference/toolsets-reference>
- Memory: <https://hermes-agent.nousresearch.com/docs/user-guide/features/memory>
- Skills: <https://hermes-agent.nousresearch.com/docs/user-guide/features/skills>
- Messaging gateway: <https://hermes-agent.nousresearch.com/docs/user-guide/messaging>
- Browser automation: <https://hermes-agent.nousresearch.com/docs/user-guide/features/browser>
- Cron: <https://hermes-agent.nousresearch.com/docs/user-guide/features/cron>

## Summary

Code Buddy covers the **shape** of Hermes: multi-provider agent loop, persistent
memory, skills, filtered toolsets, scheduling, delegation, session recall,
channels, browser tooling, MCP, and run trajectories. The local Hermes surface
is explicitly a native TypeScript/Fleet mapping, not a vendored Hermes runtime
(`buddy hermes profile/plan/doctor/hooks`).

The missing pieces are mostly **exact upstream product surfaces**: full
official gateway/toolset matrix, complete browser backend matrix, Nous Portal
Tool Gateway, all memory providers, Kanban tools, OpenClaw migration, and
several research/runtime backends. The first concrete gap from this audit,
`hermes prompt-size`, now has a native Code Buddy equivalent:
`buddy hermes prompt-size`.

## Parity matrix

| Area | Official Hermes surface | Code Buddy evidence | Status | Notes |
|---|---|---|---|---|
| Agent identity | Hermes product agent with its own Python runtime | `src/agent/hermes-agent-profile.ts`, `src/commands/cli/hermes-commands.ts` | Partial | Code Buddy maps Hermes ideas to native primitives; it does not vendor or run upstream Hermes Python. |
| CLI/TUI | Full terminal TUI, `hermes chat`, `hermes model`, `hermes tools`, `hermes prompt-size`, etc. | Main CLI, slash commands, `buddy hermes *`, `buddy tools *`, `buddy cron *`, `buddy hermes prompt-size` | Partial | No exact `hermes model` provider setup wizard found; prompt-size now has a native Hermes-style equivalent. |
| Prompt-size diagnostic | `hermes prompt-size` offline byte breakdown for system prompt and tool schemas | `buddy hermes prompt-size [profile] [--json]`; `tests/commands/hermes-commands.test.ts` | Covered/partial | Runs offline and reports Hermes prompt, profile/toolset/plan JSON, local skills/memory footprint metadata, active tool schemas, and profile-filtered tools. It is native Code Buddy output, not byte-for-byte upstream Hermes output. |
| Providers/models | Nous Portal, OpenRouter, OpenAI/Codex, Copilot, Anthropic, Gemini, Hugging Face, Novita, z.ai, Kimi, MiniMax, Bedrock, Azure, local/custom, etc. | Code Buddy provider routing, OpenAI-compatible client, Gemini native path, model tools config | Covered/partial | Strong coverage, but exact provider list and setup flows differ. |
| Toolsets | Core/composite/platform/dynamic toolsets; per-platform `hermes-cli`, `hermes-discord`, `hermes-feishu`, etc. | Fleet dispatch profiles and `fleet.hermes.<profile>` descriptors; active tool filter enforcement | Partial | Code Buddy has useful Hermes-style filters, not the full official per-platform toolset catalog. |
| Built-in tools | Browser, file, terminal/process, web, Home Assistant, Spotify, Kanban, `execute_code`, `cronjob`, `session_search`, skills, TTS, image/video, vision, messaging, MOA, X search, Yuanbao, MCP | Code Buddy has many native tools plus Firecrawl, browser/CDP, sessions, skills, Fleet, image/vision/voice pieces | Partial | Not a one-to-one tool-name or capability set; no proof for Home Assistant, Spotify, Yuanbao, `execute_code` RPC, or Kanban tools. |
| Messaging gateway | Single gateway process across Telegram, Discord, Slack, WhatsApp, Signal, SMS, Email, Home Assistant, Mattermost, Matrix, DingTalk, Feishu, WeCom, Weixin, BlueBubbles, QQ, Yuanbao, Teams, LINE, ntfy, Open WebUI, etc. | `src/channels/*`, `docs/channels.md`, `src/server/channel-a2a-bridge.ts`; many channels including Telegram/Discord/Slack/WhatsApp/Signal/Matrix/Teams/LINE/Feishu/iMessage/etc. | Partial | Code Buddy is broad, but the official Hermes platform list, per-platform toolsets, gateway lifecycle, and slash parity are not identical. |
| Browser automation | Browserbase, Browser Use, Firecrawl, Camofox/Camoufox, local CDP, agent-browser, hybrid public/private routing, dialog handling, session recording | Stagehand/CDP/browser automation, Firecrawl tools, browser watchdogs, security audit around CDP | Partial | Strong local browser work, but no complete proof of Hermes backend parity, especially Camofox, Browser Use gateway mode, hybrid private routing, and `browser_dialog`. |
| Nous Portal Tool Gateway | OAuth setup, `hermes portal status`, gateway-routed Firecrawl/FAL/OpenAI TTS/Browser Use | Separate provider/tool integrations; no Nous Portal command surface found | Gap | This is an upstream subscription-specific integration, not currently a Code Buddy equivalent. |
| Memory | Built-in memory plus external providers: Honcho, OpenViking, Mem0, Hindsight, Holographic, RetainDB, ByteRover, Supermemory | Local memory, FTS/session recall, user model, Mem0/Honcho/Supermemory adapters | Partial | Three external providers exist; the full Hermes provider matrix does not. Some older status docs still understate newer local dialectic work. |
| Skills | Agentskills.io-compatible skills, hub/taps, direct URL install, trust/update lifecycle, curator, agent-managed skills | `src/skills/hub.ts`, skill loader/manager, skill discovery/install tool, skill curator/candidate review | Partial | Good native coverage; not proven identical to Hermes hub/tap/update/reset/trust behavior. |
| Closed learning loop | Agent memory nudges, autonomous skill creation, self-improving skills, session search, Honcho modeling | Lessons, user model, session recall, skill candidate queue, curator | Partial | Comparable direction; Code Buddy keeps review gates and differs from Hermes' more autonomous posture. |
| Cron/scheduling | Natural-language `cronjob` tool; create/list/update/pause/resume/run/remove; platform delivery; no-agent script-only jobs; chained jobs; skill-backed jobs | `buddy cron list/show/add/remove`, scheduler, pre-checks, watchdog, delivery, run recording; Cowork scheduled tasks | Partial | Missing exact `cronjob` agent tool semantics, update/pause/resume/run parity, skill-backed/chained/script-only details. |
| Delegation/parallelism | `delegate_task`, isolated subagents, `execute_code` scripts calling tools by RPC | Fleet peer chat/session/tool invoke, route_peer, subagents, agentic coding runner | Partial | Delegation is strong; `execute_code` RPC collapse was not found. |
| Runs anywhere | Local, Docker, SSH, Singularity, Modal, Daytona terminal backends with hibernate/wake semantics | Local/desktop/server/fleet/sandbox/device work exists | Gap/partial | No full official backend matrix found. |
| Research trajectories | Batch trajectory generation and trajectory compression for training/research | `buddy run trajectory-export`, golden/policy evals, run recall packs | Partial | Trajectory export/evals are real; official batch runner/compression parity not found. |
| Kanban | `hermes kanban` and `kanban_*` coordination tools | Fleet saga/spec/agentic harness surfaces | Gap/partial | Similar coordination concepts, not the official Kanban board/toolset. |
| MCP/ACP | MCP config/catalog/server mode; ACP server/editor integration | MCP infrastructure and A2A/Fleet surfaces; ACP-related channel tests/docs | Partial | MCP is present; exact `hermes-acp` parity is not established. |
| OpenClaw migration | `hermes claw migrate` with 30+ categories | OpenClaw audit/imported patterns and identity files | Gap | No equivalent migration command found. |

## Highest-value next work

1. Convert this audit into a machine-checkable parity manifest.
   - Each Hermes feature row should have local evidence paths, a status, and a
     verification command.
2. Close the user-facing gaps first: provider/model setup clarity, gateway
   status, cron pause/resume/update/run, and Cowork screens for the active
   Hermes/Fleet toolset.
3. Treat deep parity items as optional product decisions: Nous Portal, Camofox,
   full OpenClaw migration, official Kanban, all memory providers, Modal/Daytona.

## Commands used locally

- `git -C D:/CascadeProjects/_external/hermes-agent fetch --all --tags --prune`
- `git -C D:/CascadeProjects/_external/hermes-agent log -1 --oneline --decorate origin/main`
- `git -C D:/CascadeProjects/_external/hermes-agent show origin/main:README.md`
- `git -C D:/CascadeProjects/_external/hermes-agent show origin/main:website/docs/reference/cli-commands.md`
- `git -C D:/CascadeProjects/_external/hermes-agent show origin/main:website/docs/reference/toolsets-reference.md`
- `rg -n "prompt-size|prompt size|PromptSize|promptSize" src tests docs cowork`
- `rg --files src/channels`
- `rg -n "Mem0|Honcho|Supermemory|OpenViking|Hindsight|Holographic|RetainDB|ByteRover" src tests docs cowork`
- `rg -n "execute_code|delegate_task|mixture_of_agents|session_search|skill_manage|skills_list|skill_view|send_message|text_to_speech|image_generate|video_generate|vision_analyze|video_analyze|computer_use|homeassistant|spotify|x_search|kanban_" src/codebuddy src/tools src/commands tests docs`
- `npm test -- tests/commands/hermes-commands.test.ts --run`
- `npx tsx src/index.ts hermes prompt-size safe --json`

## Caveats

- This is a source/docs audit, not a live side-by-side Hermes runtime test.
- Some Code Buddy docs are stale relative to later implementation work; prefer
  source and tests over older status pages when they disagree.
- "Partial" can still mean "useful and working"; it only means not exact
  official Hermes parity.
