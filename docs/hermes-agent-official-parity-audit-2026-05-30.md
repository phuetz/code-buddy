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
- Local official sparse mirror inspected at `%TEMP%/hermes-agent-official-*`.
- Fetched upstream commit: `5921d667` on `origin/main`.
- Latest tag observed remotely: `v2026.5.29.2`.
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
Tool Gateway, all memory providers, OpenClaw migration, and several optional
platform connectors. Several concrete gaps from this audit now have native
Code Buddy equivalents: `buddy hermes prompt-size`, exact `kanban_*`,
exact `send_message`, exact `execute_code` with persisted run artifacts, and
exact local `vision_analyze` / `browser_vision` / `text_to_speech` tools.

## Parity matrix

| Area | Official Hermes surface | Code Buddy evidence | Status | Notes |
|---|---|---|---|---|
| Agent identity | Hermes product agent with its own Python runtime | `src/agent/hermes-agent-profile.ts`, `src/commands/cli/hermes-commands.ts` | Partial | Code Buddy maps Hermes ideas to native primitives; it does not vendor or run upstream Hermes Python. |
| CLI/TUI | Full terminal TUI, `hermes chat`, `hermes model`, `hermes tools`, `hermes prompt-size`, etc. | Main CLI, slash commands, `buddy hermes *`, `buddy tools *`, `buddy cron *`, `buddy hermes prompt-size` | Partial | No exact `hermes model` provider setup wizard found; prompt-size now has a native Hermes-style equivalent. |
| Prompt-size diagnostic | `hermes prompt-size` offline byte breakdown for system prompt and tool schemas | `buddy hermes prompt-size [profile] [--json]`; `tests/commands/hermes-commands.test.ts` | Covered/partial | Runs offline and reports Hermes prompt, profile/toolset/plan JSON, local skills/memory footprint metadata, active tool schemas, and profile-filtered tools. It is native Code Buddy output, not byte-for-byte upstream Hermes output. |
| Providers/models | Nous Portal, OpenRouter, OpenAI/Codex, Copilot, Anthropic, Gemini, Hugging Face, Novita, z.ai, Kimi, MiniMax, Bedrock, Azure, local/custom, etc. | Code Buddy provider routing, OpenAI-compatible client, Gemini native path, model tools config | Covered/partial | Strong coverage, but exact provider list and setup flows differ. |
| Toolsets | Core/composite/platform/dynamic toolsets; per-platform `hermes-cli`, `hermes-discord`, `hermes-feishu`, etc. | Fleet dispatch profiles and `fleet.hermes.<profile>` descriptors; active tool filter enforcement | Partial | Code Buddy has useful Hermes-style filters, not the full official per-platform toolset catalog. |
| Built-in tools | Browser, file, terminal/process, web, Home Assistant, Spotify, Kanban, `execute_code`, `cronjob`, `session_search`, skills, TTS, image/video, vision, messaging, MOA, X search, Yuanbao, MCP | Code Buddy has many native tools plus Firecrawl, browser/CDP, sessions, skills, Fleet, image/vision/voice pieces, exact `kanban_*`, exact `send_message`, exact `execute_code`, exact `vision_analyze`, exact `browser_vision`, and exact `text_to_speech` | Partial | Not a one-to-one tool-name or capability set; no proof for Home Assistant, Spotify, or Yuanbao. Kanban, send_message, execute_code, vision_analyze, browser_vision, and text_to_speech now have exact prompt-tool names with native safety boundaries. |
| Messaging gateway | Single gateway process across Telegram, Discord, Slack, WhatsApp, Signal, SMS, Email, Home Assistant, Mattermost, Matrix, DingTalk, Feishu, WeCom, Weixin, BlueBubbles, QQ, Yuanbao, Teams, LINE, ntfy, Open WebUI, etc. | `src/channels/*`, `src/channels/send-message.ts`, `docs/channels.md`, `src/server/channel-a2a-bridge.ts`, `buddy channels status --json`; many channels including Telegram/Discord/Slack/WhatsApp/Signal/Matrix/Teams/LINE/Feishu/iMessage/etc. | Partial | Code Buddy is broad, gateway readiness is machine-readable without secret leakage, and `send_message` now dry-runs to a real outbox by default with approval-gated live delivery. The official Hermes platform list, per-platform toolsets, gateway lifecycle, and slash parity are still not identical. |
| Browser automation | Browserbase, Browser Use, Firecrawl, Camofox/Camoufox, local CDP, agent-browser, hybrid public/private routing, dialog handling, session recording | Stagehand/CDP/browser automation, Firecrawl tools, browser watchdogs, exact browser dialog and browser vision surfaces, security audit around CDP | Partial | Strong local browser work, but no complete proof of Hermes backend parity for Camofox, Browser Use gateway mode, hybrid private routing, and session recording. |
| Nous Portal Tool Gateway | OAuth setup, `hermes portal status`, gateway-routed Firecrawl/FAL/OpenAI TTS/Browser Use | Separate provider/tool integrations; no Nous Portal command surface found | Gap | This is an upstream subscription-specific integration, not currently a Code Buddy equivalent. |
| Memory | Built-in memory plus external providers: Honcho, OpenViking, Mem0, Hindsight, Holographic, RetainDB, ByteRover, Supermemory | Local memory, FTS/session recall, user model, Mem0/Honcho/Supermemory adapters | Partial | Three external providers exist; the full Hermes provider matrix does not. Some older status docs still understate newer local dialectic work. |
| Skills | Agentskills.io-compatible skills, hub/taps, direct URL install, trust/update lifecycle, curator, agent-managed skills | `src/skills/hub.ts`, skill loader/manager, skill discovery/install tool, skill curator/candidate review | Partial | Good native coverage; not proven identical to Hermes hub/tap/update/reset/trust behavior. |
| Closed learning loop | Agent memory nudges, autonomous skill creation, self-improving skills, session search, Honcho modeling; source check: `agent/background_review.py`, `agent/trajectory.py`, `trajectory_compressor.py` | Lessons, user model, session recall, skill candidate queue, curator, `Learning Agent` over real `RunStore` trajectories | Partial/covered core loop | Comparable direction; Code Buddy now has the retrospective loop, candidate skill materialization, and outcome telemetry, but keeps review gates instead of Hermes' direct background skill writes. |
| Cron/scheduling | Natural-language `cronjob` tool; create/list/update/pause/resume/run/remove; platform delivery; no-agent script-only jobs; chained jobs; skill-backed jobs | `buddy cron list/show/add/update/pause/resume/run/remove`, scheduler, pre-checks, watchdog, delivery, run recording; Cowork scheduled tasks | Partial | Direct CLI lifecycle parity now covers add/list/show/update/pause/resume/run/remove with isolated-store smoke coverage. Still missing exact `cronjob` agent tool semantics and skill-backed/chained/script-only details. |
| Delegation/parallelism | `delegate_task`, isolated subagents, `execute_code` scripts calling tools by RPC | Fleet peer chat/session/tool invoke, route_peer, subagents, agentic coding runner, exact `execute_code` subprocess artifacts | Partial | Delegation is strong and `execute_code` now exists as a bounded local subprocess boundary; optional generated-code-to-tool RPC collapse remains a separate security/product decision. |
| Runs anywhere | Local, Docker, SSH, Singularity, Modal, Daytona terminal backends with hibernate/wake semantics | Local/desktop/server/fleet/sandbox/device work exists | Gap/partial | No full official backend matrix found. |
| Research trajectories | Batch trajectory generation and trajectory compression for training/research | `buddy run trajectory-export`, golden/policy evals, run recall packs | Partial | Trajectory export/evals are real; official batch runner/compression parity not found. |
| Kanban | `hermes kanban` and `kanban_*` coordination tools | `src/kanban/kanban-store.ts`, `src/tools/registry/kanban-tools.ts`, `buddy hermes kanban *`, `tests/tools/kanban-real.test.ts` | Covered/partial | Exact `kanban_show/list/create/complete/block/comment/link/unblock/heartbeat` tool names exist with a persistent workspace board. Upstream UI/lifecycle semantics may still differ. |
| MCP/ACP | MCP config/catalog/server mode; ACP server/editor integration | MCP infrastructure and A2A/Fleet surfaces; ACP-related channel tests/docs | Partial | MCP is present; exact `hermes-acp` parity is not established. |
| OpenClaw migration | `hermes claw migrate` with 30+ categories | OpenClaw audit/imported patterns and identity files | Gap | No equivalent migration command found. |

## Highest-value next work

1. Keep the machine-checkable parity manifest current.
   - `buddy hermes parity --json` exposes each Hermes feature row with local
     evidence paths, status, and verification commands.
2. Close the user-facing gaps first: provider/model setup clarity and Cowork screens for the active
   Hermes/Fleet toolset.
3. Treat deep parity items as optional product decisions: Nous Portal, Camofox,
   full OpenClaw migration, all memory providers, Modal/Daytona.

## Commands used locally

- `git ls-remote https://github.com/NousResearch/hermes-agent.git HEAD refs/tags/v2026.5.*`
- `git clone --depth 1 --filter=blob:none --sparse https://github.com/NousResearch/hermes-agent.git %TEMP%/hermes-agent-official-*`
- `git -C %TEMP%/hermes-agent-official-* show HEAD:toolsets.py`
- `rg -n "learning loop|self-improv|skill|curator|hindsight|trajectory|session_search|cron|toolset" README.md RELEASE_v0.15.0.md RELEASE_v0.15.1.md docs agent skills tools trajectory_compressor.py run_agent.py hermes_cli cron`
- `rg -n "prompt-size|prompt size|PromptSize|promptSize" src tests docs cowork`
- `rg --files src/channels`
- `rg -n "Mem0|Honcho|Supermemory|OpenViking|Hindsight|Holographic|RetainDB|ByteRover" src tests docs cowork`
- `rg -n "execute_code|delegate_task|mixture_of_agents|session_search|skill_manage|skills_list|skill_view|send_message|text_to_speech|image_generate|video_generate|vision_analyze|video_analyze|computer_use|homeassistant|spotify|x_search|kanban_" src/codebuddy src/tools src/commands tests docs`
- `npm test -- tests/commands/hermes-commands.test.ts --run`
- `npx tsx src/index.ts hermes prompt-size safe --json`
- `npm test -- tests/tools/kanban-real.test.ts --run`
- `npm test -- tests/tools/send-message-real.test.ts --run`
- `npm test -- tests/tools/execute-code-real.test.ts --run`
- `npm test -- tests/tools/vision-analyze-real.test.ts --run`
- `npm test -- tests/tools/text-to-speech-real.test.ts --run`
- `npx tsx src/index.ts hermes kanban list --json`
- `npx tsx src/index.ts hermes parity --json`

## Caveats

- This is a source/docs audit, not a live side-by-side Hermes runtime test.
- Some Code Buddy docs are stale relative to later implementation work; prefer
  source and tests over older status pages when they disagree.
- "Partial" can still mean "useful and working"; it only means not exact
  official Hermes parity.
