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
Tool Gateway live proxy/OAuth, all memory providers, OpenClaw migration, and several optional
platform connectors. Several concrete gaps from this audit now have native
Code Buddy equivalents: `buddy hermes prompt-size`, exact `kanban_*`,
exact `send_message`, exact core `discord`, exact `execute_code` with
persisted run artifacts, and exact local `vision_analyze` / `browser_vision` /
`text_to_speech`, exact `image_generate` / `video_analyze` / `video_generate`,
exact Home Assistant `ha_*` tools, exact Spotify tools, exact `x_search`, exact
Feishu document/comment tools, exact Yuanbao group/DM/sticker tools, exact
`skill_manage` prompt-tool actions, exact `mixture_of_agents`, plus a local
`buddy hermes portal` readiness/catalog surface for the Nous Portal Tool Gateway.

## Parity matrix

| Area | Official Hermes surface | Code Buddy evidence | Status | Notes |
|---|---|---|---|---|
| Agent identity | Hermes product agent with its own Python runtime | `src/agent/hermes-agent-profile.ts`, `src/agent/hermes-agent-diagnostics.ts`, `src/commands/cli/hermes-commands.ts` | Covered/partial | Code Buddy exposes the native TypeScript/Fleet runtime mapping through profile, diagnostics, and identity status; it does not vendor or run upstream Hermes Python. |
| CLI/TUI | Full terminal TUI, `hermes chat`, `hermes model`, `hermes tools`, `hermes prompt-size`, etc. | Main CLI, slash commands, `buddy hermes *`, `buddy tools *`, `buddy cron *`, `buddy hermes prompt-size` | Partial | No exact `hermes model` provider setup wizard found; prompt-size now has a native Hermes-style equivalent. |
| Prompt-size diagnostic | `hermes prompt-size` offline byte breakdown for system prompt and tool schemas | `buddy hermes prompt-size [profile] [--json]`; `tests/commands/hermes-commands.test.ts` | Covered/partial | Runs offline and reports Hermes prompt, profile/toolset/plan JSON, local skills/memory footprint metadata, active tool schemas, and profile-filtered tools. It is native Code Buddy output, not byte-for-byte upstream Hermes output. |
| Providers/models | Nous Portal, OpenRouter, OpenAI/Codex, Copilot, Anthropic, Gemini, Hugging Face, Novita, z.ai, Kimi, MiniMax, Bedrock, Azure, local/custom, etc. | Code Buddy provider routing, OpenAI-compatible client, Gemini native path, model tools config, `buddy hermes doctor --json`, `buddy hermes portal status --json`, Cowork Settings -> API and Fleet Command Center provider readiness strip | Covered/partial | Strong coverage; Hermes doctor and Cowork now report active model source, inferred provider, env/OAuth credential source names, tool-call/reasoning/vision flags, context/output limits, remediation hints, and Nous Portal readiness. Exact upstream provider list and setup flows still differ. |
| Toolsets | Core/composite/platform/dynamic toolsets; per-platform `hermes-cli`, `hermes-discord`, `hermes-feishu`, etc. | Fleet dispatch profiles, `fleet.hermes.<profile>` descriptors, active tool filter enforcement, and `buddy hermes toolsets [profile] --json` | Partial | Code Buddy has a dedicated native Fleet/Hermes toolset catalog and policy preview, but not the full official per-platform toolset catalog. |
| Built-in tools | Browser, file, terminal/process, web, Home Assistant, Spotify, Kanban, `execute_code`, `cronjob`, `session_search`, skills, TTS, image/video, vision, messaging, MOA, X search, Feishu, Yuanbao, MCP | Code Buddy has many native tools plus Firecrawl, browser/CDP, sessions, skills, Fleet, image/vision/voice pieces, exact `kanban_*`, exact `send_message`, exact core `discord`, exact `discord_admin`, exact Home Assistant `ha_*`, exact Spotify tools, exact `x_search`, exact Feishu document/comment tools, exact Yuanbao group/DM/sticker tools, exact `skill_manage`, exact `mixture_of_agents`, exact `execute_code`, exact `vision_analyze`, exact `browser_vision`, exact `text_to_speech`, and exact `image_generate` / `video_analyze` / `video_generate`; `buddy hermes tools --json` is the second-level tool parity manifest | Covered/partial | Current measured tool-level state is 65 exact, 6 native-equivalent, 0 partial, and 0 gaps. Remaining product differences such as gateway lifecycle, managed browser backends, provider setup, and remote runtimes are tracked by their dedicated rows instead of this built-in tools row. |
| Messaging gateway | Single gateway process across Telegram, Discord, Slack, WhatsApp, Signal, SMS, Email, Home Assistant, Mattermost, Matrix, DingTalk, Feishu, WeCom, Weixin, BlueBubbles, QQ, Yuanbao, Teams, LINE, ntfy, Open WebUI, etc. | `src/channels/*`, `src/channels/send-message.ts`, `src/tools/discord-platform-tool.ts`, `docs/channels.md`, `src/server/channel-a2a-bridge.ts`, `buddy channels status --json`, `cowork/src/main/tools/channel-gateway-readiness-bridge.ts`, `cowork/src/renderer/components/hermes-messaging-gateway-strip.tsx`, `cowork/src/renderer/components/ChannelsPanel.tsx`; many channels including Telegram/Discord/Slack/WhatsApp/Signal/Matrix/Teams/LINE/Feishu/iMessage/etc. | Partial | Code Buddy is broad, gateway readiness is machine-readable in CLI and Cowork without secret leakage, `send_message` dry-runs to a real outbox by default with approval-gated live delivery, and exact `discord` plus `discord_admin` cover upstream Discord REST actions. The official Hermes platform list, gateway lifecycle, and slash parity are still not identical. |
| Browser automation | Browserbase, Browser Use, Firecrawl, Camofox/Camoufox, local CDP, agent-browser, hybrid public/private routing, dialog handling, session recording | Stagehand/CDP/browser automation, Firecrawl tools, browser watchdogs, exact browser dialog and browser vision surfaces, `buddy hermes browser status --json`, `buddy hermes browser-smoke local-playwright --json`, Cowork Settings -> API and Fleet Command Center browser backend strip, security audit around CDP | Partial | Strong local browser work plus machine-readable backend readiness for local Playwright, CDP, Browserbase/Stagehand, Browser Use gateway, Firecrawl, Camofox, and session recording. Cowork can render the same status and trigger the local Playwright smoke. The local Playwright smoke launches a real Chromium instance. First-class managed backend runners, hybrid routing, and full session recording remain incomplete. |
| Nous Portal Tool Gateway | OAuth setup, `hermes portal status`, gateway-routed Firecrawl/FAL/OpenAI TTS/Browser Use | `src/agent/hermes-portal-status.ts`, `buddy hermes portal status|tools|open`, direct provider/tool integrations | Covered/partial | Code Buddy now has local readiness/catalog parity with credential-source reporting, subscription/docs links, Tool Gateway URL/flag detection, managed-vs-direct routing for Firecrawl/FAL/TTS/Browser Use/Modal, and no secret-value output. Live OAuth device-code and an actual Nous-managed proxy runtime are not implemented. |
| Memory | Built-in memory plus external providers: Honcho, OpenViking, Mem0, Hindsight, Holographic, RetainDB, ByteRover, Supermemory | Local memory, FTS/session recall, user model, Mem0/Honcho/Supermemory adapters, `buddy hermes memory status --json`, Cowork memory-provider readiness strip | Partial | Three external providers exist and are now reported through a secret-safe readiness matrix with active provider, credential source names, fallback status, and missing official adapters. OpenViking/Hindsight/Holographic/RetainDB/ByteRover are still absent. Some older status docs still understate newer local dialectic work. |
| Skills | Agentskills.io-compatible skills, hub/taps, direct URL install, trust/update lifecycle, curator, agent-managed skills | `src/skills/hub.ts`, skill loader/manager, skill discovery/install tool, skill curator/candidate review, Cowork skill review strips | Partial | Exact `skill_manage` prompt-tool action parity is now covered, including `edit`, `write_file`, `remove_file`, and supporting-file patch aliases. Cowork can review candidate-vs-installed `SKILL.md` changes with bounded unified and expanded side-by-side diffs before approved install/overwrite. `buddy skills tap list/add/remove/trust/refresh` now persists repository taps with path/trust metadata and refreshes discovered skills through real GitHub Contents API paths. `buddy skills well-known <url>` discovers `.well-known/skills/index.json` catalogs into the same cache. `buddy skills update-preview` and `skill_manage action=preview_update` provide bounded remote update diffs before reviewer-gated writes. `buddy skills reset` and `skill_manage action=reset` are Code Buddy extensions, not official Hermes actions, but they close the practical repair gap by restoring installed skills from real hub/cache content after reviewer approval. |
| Closed learning loop | Agent memory nudges, autonomous skill creation, self-improving skills, session search, Honcho modeling; source check: `agent/background_review.py`, `agent/trajectory.py`, `trajectory_compressor.py` | Lessons, user model, session recall, skill candidate queue, curator, `Learning Agent` over real `RunStore` trajectories | Partial/covered core loop | Comparable direction; Code Buddy now has the retrospective loop, candidate skill materialization, and outcome telemetry, but keeps review gates instead of Hermes' direct background skill writes. |
| Cron/scheduling | Natural-language `cronjob` tool; create/list/update/pause/resume/run/remove; platform delivery; no-agent script-only jobs; chained jobs; skill-backed jobs | `buddy cron list/show/add/update/pause/resume/run/remove`, exact `cronjob` prompt tool, scheduler, pre-checks, watchdog, delivery, run recording; Cowork scheduled tasks | Partial | Direct CLI lifecycle parity and exact agent-facing `cronjob` semantics now cover list/show/create/pause/resume/run/remove with isolated-store smoke coverage. Still missing skill-backed, chained and script-only no-agent workflow details if those remain product-relevant. |
| Delegation/parallelism | `delegate_task`, isolated subagents, `execute_code` scripts calling tools by RPC | Fleet peer chat/session/tool invoke, route_peer, subagents, agentic coding runner, exact `execute_code` subprocess artifacts | Partial | Delegation is strong and `execute_code` now exists as a bounded local subprocess boundary; optional generated-code-to-tool RPC collapse remains a separate security/product decision. |
| Runs anywhere | Local, Docker, SSH, Singularity, Modal, Daytona terminal backends with hibernate/wake semantics | Local/desktop/server/fleet/sandbox/device work exists; `buddy hermes doctor --json`, `buddy hermes runtime-smoke`, and Cowork runtime backend inventory | Partial | Hermes doctor and Cowork now report real non-destructive probes, version/status, credential source names only, smoke commands, and opt-in live smoke execution for local Node and WSL through real subprocesses when available. Full managed remote backend lifecycle is still not implemented. |
| Research trajectories | Batch trajectory generation and trajectory compression for training/research | `buddy run trajectory-export`, `buddy run trajectory-batch`, `buddy run recall-pack`, golden/policy evals, `buddy hermes trajectories status --json` | Covered/partial | Trajectory export, batch redacted trajectory collection, compressed agent context, recall compression, Learning Agent retrospectives, evals, and a machine-readable compatibility report are real. Exact upstream training-data pipeline semantics may still differ, but the core research-trajectory batch/compression surface is now implemented natively. |
| Kanban | `hermes kanban` and `kanban_*` coordination tools | `src/kanban/kanban-store.ts`, `src/tools/registry/kanban-tools.ts`, `buddy hermes kanban *`, `tests/tools/kanban-real.test.ts` | Covered/partial | Exact `kanban_show/list/create/complete/block/comment/link/unblock/heartbeat` tool names exist with a persistent workspace board. Upstream UI/lifecycle semantics may still differ. |
| MCP/ACP | MCP config/catalog/server mode; ACP server/editor integration | MCP client/server, A2A HTTP, ACP HTTP, channel-to-A2A bridge, `buddy hermes protocols status --json`, `buddy hermes protocols-smoke local --json` | Partial | Core protocol gateways are now machine-readable and smoke-testable with a real MCP stdio server plus loopback A2A/ACP HTTP routes. Exact upstream `hermes-acp` editor packaging is still not claimed. |
| OpenClaw migration | `hermes claw migrate` with 30+ categories | OpenClaw audit/imported patterns and identity files | Gap → Partial (2026-06-01) | **Update 2026-06-07:** `buddy hermes claw migrate` is implemented against the documented OpenClaw layout (`~/.openclaw`/`~/.clawdbot`/`~/.moltbot` + `clawdbot.json`): dry-run by default, secret-safe, recognizing 35 categories and importing identity files/MEMORY/default model/MCP servers/skills/custom slash commands/agent settings to real consumer-backed destinations while archiving the rest for review. Fixture-tested; no real OpenClaw install validated. Full upstream certification remains deferred. |

## Highest-value next work

1. Keep the machine-checkable parity manifest current.
   - `buddy hermes parity --json` exposes each Hermes feature row with local
     evidence paths, status, and verification commands.
2. Close the remaining user-facing gaps first: exact upstream provider setup
   flows and the active Hermes/Fleet toolset. CLI JSON and Cowork provider/model
   readiness are now available through `buddy hermes doctor --json` and the
   Settings -> API / Fleet Command Center strips.
3. Treat deep parity items as optional product decisions: live Nous Portal
   OAuth/proxying, Camofox, all memory providers, and first-class Modal/Daytona/Vercel
   managed runners. Runtime backend inventory is now visible in Hermes doctor
   and Cowork, with live local and WSL smoke runners.
4. Keep full OpenClaw migration for the end, after the Hermes core and Cowork
   cockpit are stable.

## Commands used locally

- `git ls-remote https://github.com/NousResearch/hermes-agent.git HEAD refs/tags/v2026.5.*`
- `git clone --depth 1 --filter=blob:none --sparse https://github.com/NousResearch/hermes-agent.git %TEMP%/hermes-agent-official-*`
- `git -C %TEMP%/hermes-agent-official-* show HEAD:toolsets.py`
- `rg -n "learning loop|self-improv|skill|curator|hindsight|trajectory|session_search|cron|toolset" README.md RELEASE_v0.15.0.md RELEASE_v0.15.1.md docs agent skills tools trajectory_compressor.py run_agent.py hermes_cli cron`
- `rg -n "prompt-size|prompt size|PromptSize|promptSize" src tests docs cowork`
- `rg --files src/channels`
- `rg -n "Mem0|Honcho|Supermemory|OpenViking|Hindsight|Holographic|RetainDB|ByteRover" src tests docs cowork`
- `rg -n "execute_code|delegate_task|mixture_of_agents|session_search|skill_manage|skills_list|skill_view|send_message|discord|text_to_speech|image_generate|video_generate|vision_analyze|video_analyze|computer_use|homeassistant|spotify|x_search|kanban_" src/codebuddy src/tools src/commands tests docs`
- `npm test -- tests/commands/hermes-commands.test.ts --run`
- `cd cowork && npm test -- --run tests/hermes-provider-readiness-bridge.test.ts tests/hermes-provider-readiness-strip.test.ts`
- `npx tsx src/index.ts hermes prompt-size safe --json`
- `npx tsx src/index.ts hermes doctor balanced --json`
- `npm test -- tests/tools/kanban-real.test.ts --run`
- `npm test -- tests/tools/send-message-real.test.ts --run`
- `npm test -- tests/tools/discord-tool-real.test.ts --run`
- `npm test -- tests/tools/homeassistant-tool-real.test.ts --run`
- `npm test -- tests/tools/execute-code-real.test.ts --run`
- `npm test -- tests/tools/vision-analyze-real.test.ts --run`
- `npm test -- tests/tools/text-to-speech-real.test.ts --run`
- `npm test -- tests/tools/media-generation-real.test.ts tests/agent/hermes-tool-parity-local.test.ts tests/commands/hermes-commands.test.ts --run`
- `npx tsx src/index.ts hermes kanban list --json`
- `npx tsx src/index.ts hermes tools --json`
- `npx tsx src/index.ts hermes portal status --json`
- `npx tsx src/index.ts hermes portal tools --json`
- `npx tsx src/index.ts hermes parity --json`

## Caveats

- This is a source/docs audit, not a live side-by-side Hermes runtime test.
- Some Code Buddy docs are stale relative to later implementation work; prefer
  source and tests over older status pages when they disagree.
- "Partial" can still mean "useful and working"; it only means not exact
  official Hermes parity.
