<div align="center">

<img src="https://img.shields.io/badge/🤖-Code_Buddy-blueviolet?style=for-the-badge&labelColor=1a1a2e" alt="Code Buddy"/>

# Code Buddy

### Your AI-Powered Development Tool & Personal Assistant

<p align="center">
  <a href="https://www.npmjs.com/package/@phuetz/code-buddy"><img src="https://img.shields.io/npm/v/@phuetz/code-buddy.svg?style=flat-square&color=ff6b6b&label=version" alt="npm version"/></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-feca57.svg?style=flat-square" alt="License: MIT"/></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D18.0.0-54a0ff?style=flat-square&logo=node.js" alt="Node Version"/></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.3-5f27cd?style=flat-square&logo=typescript" alt="TypeScript"/></a>
  <a href="https://deepwiki.com/phuetz/code-buddy/"><img src="https://deepwiki.com/badge.svg" alt="Ask DeepWiki"/></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Tests-30K%2B-00d26a?style=flat-square&logo=jest" alt="Tests"/>
  <img src="https://img.shields.io/badge/Build-passing-00d26a?style=flat-square" alt="Build"/>
</p>

<br/>

### The open-source AI coding agent that runs **free, on your own machine.**

Code, commands, web, voice, and vision — from your terminal, a desktop app, your phone, or a 24/7 autonomous service. Use **local Ollama models at `$0`**, or bring any of **15 providers**. No lock-in.

<p align="center">
  <a href="cowork/readme.md#demo"><img src="docs/qa/code-buddy-studio/cowork-demo-hero.gif" alt="Code Buddy Cowork — demo" width="760"/></a>
  <br/>
  <sub>The <b>Cowork</b> desktop app — <a href="cowork/readme.md#demo">more demos (incl. live local reasoning)</a></sub>
</p>

- 🆓 **Free & local-first** — runs entirely on **local Ollama (`$0`)**, or any of **15 providers** (Claude, GPT, Grok, Gemini, …) with auto-failover. Or log in with **ChatGPT Plus/Pro** for a flat-fee brain — no API metering.
- 🧠 **Reasoning you can watch** — local models think step-by-step on screen, then act — see the [live captures](cowork/readme.md#demo).
- 🖥️ **Runs everywhere** — terminal TUI, the **Cowork desktop app**, an HTTP/WebSocket server, your phone, or a 24/7 background service — all on the same core engine.
- 🤝 **Multi-AI Fleet** — multiple peers observe each other live and call each other's models & read-only tools (`peer.chat` / `peer.tool.invoke`) across your network.
- 🤖 **Autonomous** — `buddy autonomy install` runs a self-driving service that claims & executes tasks **free-first** on local models, 24/7.
- 🛠️ **~110 tools, skills & MCP** — edit, shell, web search, browser, PDFs/Office, a skills marketplace, and MCP connectors to extend it.
- 👁️ **Personal companion** — bidirectional voice, opt-in camera/presence (MediaPipe), persistent memory, and 20+ messaging channels.

<br/>

[Quick Start](#quick-start) |
[Cowork + Companion](#cowork-desktop--buddy-companion) |
[Features](#features) |
[FAQ](docs/faq.md) |
[Documentation](#documentation) |
[Contributing](#contributing)

</div>

---

## What is Code Buddy?

Code Buddy is an open-source multi-provider AI coding agent with a terminal UI, HTTP/WebSocket server, and Cowork desktop app. It supports **15 LLM providers** with automatic failover and per-provider circuit breakers. It works as both a **development tool** (reads files, writes code, runs commands, creates PRs, plans complex tasks) and a **personal companion** (bidirectional voice conversation, durable memory, opt-in camera perception, screen/presence context, push notifications via 20+ messaging channels, and 24/7 background operation). With `buddy login`, a ChatGPT Plus / Pro subscription can become the flat-fee brain of the system without API-key metering.

---

## In action

**Free local AI, with the reasoning on screen.** A local Ollama model (`qwen3.6:35b-a3b`) thinks through a task, then *uses tools* to do it — no cloud, ~`$0.0001`. Unedited captures from the Cowork desktop app:

<table>
  <tr>
    <td width="50%" align="center">
      <a href="docs/qa/code-buddy-studio/cowork-demo-chat.mp4"><img src="docs/qa/code-buddy-studio/cowork-demo-chat.gif" alt="Local reasoning chat" width="430"/></a><br/>
      <sub><b>Reasoning chat</b> — thinks step-by-step, then answers · local · <code>~$0.0001</code></sub>
    </td>
    <td width="50%" align="center">
      <a href="docs/qa/code-buddy-studio/cowork-demo-task.mp4"><img src="docs/qa/code-buddy-studio/cowork-demo-task.gif" alt="Agent creates a file" width="430"/></a><br/>
      <sub><b>Real task</b> — reasons, <b>uses the file tool</b>, confirms the artifact · local · <code>~$0.0001</code></sub>
    </td>
  </tr>
</table>

More desktop demos (Fleet, Autonomy, Companion, …): [`cowork/readme.md`](cowork/readme.md#demo).

---

**ChatGPT Pro / Plus subscription login** — `buddy login`, sign in once with your ChatGPT account, then chat with `gpt-5.5` directly from the terminal. No API key, cost reported as `$0.0000` (flat-fee plan).

<p align="center">
  <img src="docs/screenshots/chatgpt-oauth-login.png" alt="ChatGPT OAuth login flow" width="900"/>
</p>

**Interactive TUI + tool calling.** The agent reads project context, calls tools in parallel (`web_search` ×2 for the screenshot below), and streams the synthesised answer.

<p align="center">
  <img src="docs/screenshots/tool-calling-parallel.png" alt="Tool calling parallel" width="900"/>
</p>

**Self-audit.** Asked to find a bug in its own integration code, `gpt-5.5` reads `src/codebuddy/providers/provider-chatgpt-responses.ts`, identifies a stale-variable issue (mutated `body.model` not propagated), and proposes the exact fix:

<p align="center">
  <img src="docs/screenshots/self-audit-bug-1.png" alt="Self-audit bug found" width="900"/>
</p>

More captures + walk-through: [`docs/screenshots/`](docs/screenshots/README.md).

---

## Quick Start

```bash
# Install — from source (recommended during the 1.0 release-candidate phase: gets the latest)
git clone https://github.com/phuetz/code-buddy.git
cd code-buddy && npm install && npm run build && npm link   # exposes `buddy` globally

# Or install the published release from npm
# ⚠️ during rc, the npm release can lag the source — prefer from-source for the newest features
npm install -g @phuetz/code-buddy

# Option A — bring your own API key
export GROK_API_KEY=your_api_key   # or GEMINI_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY
buddy

# Option B — log in with your ChatGPT Plus / Pro subscription (no API key needed)
buddy login                         # opens browser for OAuth → tokens persisted
buddy whoami                        # ✅ connected · your.email@example.com · Plan: pro
buddy                               # auto-routes to gpt-5.5 via the Codex backend, cost $0.0000

# Or with a specific task
buddy --prompt "analyze the codebase structure"

# Full autonomy
buddy --yolo
```

See [Getting Started](docs/getting-started.md) for installation options, headless mode, session management, and typical workflows. The ChatGPT Codex OAuth flow is documented with screenshots in [`docs/screenshots/`](docs/screenshots/README.md). The desktop cockpit has a public overview in [Cowork Desktop](docs/cowork.md).

---

## Cowork Desktop + Buddy Companion

Cowork is the desktop cockpit for Code Buddy: chat, tools, traces, workflows, settings, permissions, models, MCP connectors, skills, artifacts, and companion controls all run against the same core agent as the CLI. The Code Buddy settings panel can probe the local backend, start it when needed, discover models, and route Cowork turns through the embedded engine or a configured server endpoint.

```bash
# First-time identity and flat-fee brain route
buddy login
buddy companion setup

# Local backend for Cowork, Fleet, and OpenAI-compatible clients
buddy server --port 3000

# Launch the desktop app from an installed build
buddy gui
# or
buddy desktop

# Source checkout dev loop
npm install
npm run build
npm run dev:gui
```

Buddy companion commands are available in both the CLI and Cowork panel:

```bash
buddy companion status
buddy companion self
buddy companion evaluate
buddy companion radar
buddy companion impulses
buddy companion missions sync
buddy companion missions run-next
buddy companion safety recent
buddy companion camera status
buddy companion camera snapshot
buddy companion percepts recent
```

The camera bridge is explicit and local: snapshots are opt-in, percepts are append-only under `.codebuddy/companion/`, and Cowork uses MediaPipe Tasks Vision for face, hand, finger-tip, and pose signals. Face enrollment/presence recognition lives in Cowork's presence bridge and uses the local MediaPipe/Buffalo_S pipeline.

For low-latency voice experiments, Cowork can route STT/TTS through a local Kyutai DSM / `moshi-server` endpoint while keeping faster-whisper and Piper as fallbacks:

```bash
$env:COWORK_VOICE_PROVIDER='kyutai'
$env:COWORK_KYUTAI_URL='ws://127.0.0.1:8080'
npm run dev:gui
```

Use Buddy companion's **Inspect voice** action to probe the active route, Kyutai STT/TTS websocket reachability, `ffmpeg` availability, and the Piper/faster-whisper fallback state from the Electron app.

From source, Cowork requires Node.js `>=22` in `cowork/`; the root CLI still supports Node.js `>=18`.

---

## Features

| Category | Highlights | Docs |
|:---------|:-----------|:-----|
| **AI Providers** | 15 providers (Grok, Claude, GPT, Gemini, Ollama, LM Studio, AWS Bedrock, Azure, Groq, Together, Fireworks, OpenRouter, vLLM, Copilot, Mistral), circuit breaker, model pairs | [providers.md](docs/providers.md) |
| **Tools** | ~110 tools with RAG selection, multi-strategy edit matching, Codex-style apply_patch, streaming, BM25 tool search, code exec sandbox | [tools-reference.md](docs/tools-reference.md) |
| **Commands** | 190+ slash commands, CLI subcommands (`/dev`, `/pr`, `/lint`, `/switch`, `/think`, `/batch`, `/watch`, `/conflicts`, `/vulns`, `/replace`) | [commands.md](docs/commands.md) |
| **Cowork Desktop** | Electron cockpit, embedded Code Buddy engine, backend health/start controls, model settings, permission rules, visual workflows, traces, artifacts, MCP/skills/plugin management | [Cowork Desktop](docs/cowork.md), [cowork/readme.md](cowork/readme.md), [cowork/ARCHITECTURE.md](cowork/ARCHITECTURE.md) |
| **Buddy Companion** | ChatGPT-backed identity, voice/TTS, proactive check-ins, self-evaluation, competitive radar, mission board, learned routines, safety ledger, local percept journal | [commands.md](docs/commands.md) |
| **Vision & Presence** | Opt-in webcam snapshots, MediaPipe face/hand/pose/finger-tip analysis, local face enrollment, presence state for the agent | [cowork/ARCHITECTURE.md](cowork/ARCHITECTURE.md) |
| **Agents** | Multi-agent orchestration (5-tool API), 8 specialized agents, SWE agent, planning flow, A2A protocol, batch decomposition, agent teams | [agents.md](docs/agents.md) |
| **Reasoning** | Tree-of-Thought + MCTS (4 depth levels), extended thinking, auto-escalation, `/think` command | [reasoning.md](docs/reasoning.md) |
| **Security** | Guardian Agent (AI risk scoring), OS/Docker/OpenShell sandbox, SSRF guard, secrets vault, write policy, exec policy, loop detection, omission detection, output sanitizer | [security.md](docs/security.md) |
| **Channels** | 20+ messaging channels (Telegram, Discord, Slack, WhatsApp, Signal, Teams, Matrix, IRC, and more), DM pairing, send policy | [channels.md](docs/channels.md) |
| **Context Engine** | Smart compression, tool output masking, image pruning, transcript repair, pre-compaction flush, restorable compression, JIT context, importance-weighted window | [context-engine.md](docs/context-engine.md) |
| **Fleet & Autonomy** | Peer-to-peer hub (`peer.chat` / `peer.tool.invoke` / `peer_delegate`), A2A + ACP + MCP interop, 24/7 autonomous service (`buddy autonomy install`), event-driven daemon, claim TTL/lease, DAG task dependencies, workers→verifier→synthesizer swarm, free-first local→Tailscale→paid model tier | [fleet-guide.md](docs/fleet-guide.md) |
| **Infrastructure** | HTTP server (OpenAI-compatible), WebSocket gateway, daemon mode, cron, device nodes, canvas/A2UI, 6 cloud deploy configs, MCP, plugins | [infrastructure.md](docs/infrastructure.md) |
| **Configuration** | Env vars, TOML config with profiles, model-aware limits, per-agent params, i18n (6 locales), personas | [configuration.md](docs/configuration.md) |
| **Development** | TypeScript strict, Vitest (27,334 tests), ESM, middleware pipeline, facade architecture | [development.md](docs/development.md) |

### Additional Capabilities

- **Voice**: 7 TTS providers, wake word detection, voice-to-code pipeline, hands-free companion conversation
- **Companion Loop**: readiness checks, self-state snapshots, self-evaluation, competitive radar, impulses, missions, routines, and safety review
- **Vision**: local camera snapshots, MediaPipe face/hand/pose/finger-tip percepts, face enrollment, and presence state for context-aware collaboration
- **Memory**: Persistent + semantic + prospective + decision + coding style memory, ICM cross-session memory
- **Knowledge**: Knowledge base injection, 40 bundled skills, self-authoring skills at runtime
- **Git Workflow**: Auto-commit (Aider-style), `/pr` creation, merge conflict resolver, ghost snapshots
- **Code Intelligence**: LSP rename/refactor, auto-import, bug finder (25+ patterns, 6 langs), OpenAPI generator, log analyzer
- **IDE Integration**: VS Code extension (diff view, inline edit, model switch), JetBrains plugin, LSP server
- **Inline Context**: `@web`, `@git`, `@terminal` mentions for contextual references
- **Workflows**: Lobster typed DAG engine with approval gates, pause/resume tokens

---

## Documentation

| Document | Description |
|:---------|:------------|
| [Getting Started](docs/getting-started.md) | Prerequisites, install, first run, headless mode, session management |
| [Application Validation Guide](docs/application-validation-guide.md) | Full-app validation matrix with safe commands, evidence, and screenshot rules |
| [Providers](docs/providers.md) | All 15 providers, connection profiles, model pairs, circuit breaker |
| [Tools Reference](docs/tools-reference.md) | Tool categories, RAG selection, edit matching, apply_patch, streaming |
| [Commands](docs/commands.md) | All slash commands, CLI subcommands, companion commands, global flags |
| [Cowork Desktop](docs/cowork.md) | GitHub-visible overview, ChatGPT `gpt-5.5` route, real validation commands, screenshot privacy policy |
| [Autonomous Coding + Cowork Progress](docs/autonomous-coding-cowork-progress.md) | End-to-end autonomous task execution, RunStore artifacts, and Cowork progress tracking |
| [Cowork README](cowork/readme.md) | Desktop installation, features, source build, sandbox modes |
| [Cowork Architecture](cowork/ARCHITECTURE.md) | Electron contexts, bridges, embedded engine, persistence, runner model |
| [Agents](docs/agents.md) | Multi-agent orchestration, roles, SWE agent, planning flow, A2A |
| [Reasoning](docs/reasoning.md) | Extended thinking, Tree-of-Thought, MCTS, /think command |
| [Security](docs/security.md) | Permission modes, Guardian Agent, sandboxing, SSRF, secrets vault |
| [Channels](docs/channels.md) | 20+ messaging channels, DM pairing, send policy |
| [Context Engine](docs/context-engine.md) | Compression, tool output masking, JIT context, pre-compaction flush |
| [Infrastructure](docs/infrastructure.md) | HTTP server, WebSocket gateway, daemon, cron, deploy, plugins |
| [PdfCommander MCP Integration](docs/mcp-pdfcommander-integration.md) | Register the PdfCommander headless MCP server in `mcp.json`, verify with `buddy mcp test`, drive PDF ops from the agent |
| [Fleet Guide](docs/fleet-guide.md) | **Multi-AI hub** — `/fleet listen` + `/fleet send peer.chat`, env-driven multi-provider auto-detect, Tailscale lab examples, autonomous fleet protocol |
| [Hermes / OpenClaw Parity](docs/hermes-openclaw-parity.md) | Where Code Buddy stands vs Hermes Agent & OpenClaw — shipped capabilities, externally-gated features, and the one open code gap |
| [Configuration](docs/configuration.md) | Environment variables, TOML config, project settings, model limits |
| [Development](docs/development.md) | Build, test, architecture, coding conventions, adding tools |

---

## Validation Snapshot

Latest local verification for the Cowork + Buddy companion loop (2026-05-24):

```bash
npm run typecheck
cd cowork && npm run typecheck
cd cowork && npm run build:e2e
cd cowork && npx vitest run tests/kyutai-bridge.test.ts tests/voice-bridge.test.ts tests/tts-bridge.test.ts
cd cowork && npx playwright test e2e/cowork-smoke.spec.ts --reporter=line --workers=1
cd cowork && npx playwright test e2e/companion-panel.spec.ts --reporter=line --workers=1
cd cowork && npx playwright test e2e/recent-features-smoke.spec.ts e2e/companion-panel.spec.ts --workers=1
cd cowork && npx playwright test e2e/codebuddy-settings.spec.ts e2e/recent-features-smoke.spec.ts e2e/companion-panel.spec.ts e2e/companion-live.spec.ts --reporter=line --workers=1
cd cowork && npx vitest run
```

Result: root and Cowork typechecks passed, Vite E2E build passed with existing chunk/dynamic-import warnings, Kyutai/voice bridge unit tests passed (`31` tests), focused companion panel Playwright passed (`1` test), recent-features IPC smoke passed (`9` tests), Cowork smoke passed (`29` tests), focused companion/settings/recent-feature Playwright suite passed (`11` passed, `1` live hardware test skipped unless `COWORK_LIVE_COMPANION=1`), and Cowork Vitest passed (`205` files, `1318` tests).

---

## Contributing

```bash
git clone https://github.com/phuetz/code-buddy.git
cd code-buddy
npm install
npm run dev          # Development mode
npm test             # Run all tests
npm run validate     # Lint + typecheck + test (run before committing)
```

See [Development](docs/development.md) for architecture details and coding conventions.

---

## License

MIT License - see [LICENSE](LICENSE) for details.

---

<div align="center">

**[Report Bug](https://github.com/phuetz/code-buddy/issues)** |
**[Request Feature](https://github.com/phuetz/code-buddy/discussions)** |
**[Star on GitHub](https://github.com/phuetz/code-buddy)**

<sub>Multi-AI: Grok | Claude | ChatGPT | Gemini | LM Studio | Ollama | AWS Bedrock | Azure | Groq | Together | Fireworks | OpenRouter | vLLM | Copilot | Mistral</sub>

</div>
