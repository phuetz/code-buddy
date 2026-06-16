<div align="center">

<img src="https://img.shields.io/badge/🤖-Code_Buddy-blueviolet?style=for-the-badge&labelColor=1a1a2e" alt="Code Buddy"/>

# Code Buddy

### The open-source AI coding agent that runs **free, on your own machine**

<p align="center">
  <a href="https://www.npmjs.com/package/@phuetz/code-buddy"><img src="https://img.shields.io/npm/v/@phuetz/code-buddy.svg?style=flat-square&color=ff6b6b&label=version" alt="npm version"/></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-feca57.svg?style=flat-square" alt="License: MIT"/></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D18.0.0-54a0ff?style=flat-square&logo=node.js" alt="Node Version"/></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.3-5f27cd?style=flat-square&logo=typescript" alt="TypeScript"/></a>
  <a href="https://deepwiki.com/phuetz/code-buddy/"><img src="https://deepwiki.com/badge.svg" alt="Ask DeepWiki"/></a>
</p>

<p align="center">
  <a href="https://github.com/phuetz/code-buddy/actions/workflows/ci.yml"><img src="https://github.com/phuetz/code-buddy/actions/workflows/ci.yml/badge.svg" alt="CI"/></a>
  <img src="https://img.shields.io/badge/Tests-27K%2B-00d26a?style=flat-square&logo=jest" alt="Tests"/>
  <img src="https://img.shields.io/badge/v1.1.0-GA-blueviolet?style=flat-square" alt="Version 1.1.0 GA"/>
</p>

<br/>

Watch a **local model reason on screen, then use real tools to do the work** — no cloud, no API bill, `~$0`. Or bring any of **15 providers** (Claude, GPT, Grok, Gemini, …) with automatic failover. From your terminal, a desktop app, your phone, or a 24/7 service. No lock-in.

<p align="center">
  <a href="docs/qa/code-buddy-studio/cowork-demo-moneyshot.mp4"><img src="docs/qa/code-buddy-studio/cowork-demo-moneyshot.gif" alt="A local model reasons, then creates a file — for ~$0.0001" width="760"/></a>
  <br/>
  <sub>A <b>local</b> model reasons, then uses a tool to create a real file — <code>~$0.0001</code>, no cloud. <a href="cowork/readme.md#demo">More demos →</a></sub>
</p>

- 🆓 **Free & local-first** — runs entirely on local **Ollama (`$0`)**, any of **15 providers** with auto-failover, or a flat-fee **ChatGPT Plus/Pro** login (no API metering).
- 🧠 **Reasoning you can watch** — local models think step-by-step on screen, then call tools to act. See the [live captures](cowork/readme.md#demo).
- 🛠️ **~110 tools** — edit, shell, web search, browser, PDFs/Office, a skills marketplace, and MCP connectors to extend it.
- 🖥️ **Runs everywhere** — terminal TUI, the **Cowork** desktop app, an HTTP/WebSocket server, your phone, or a 24/7 background service — one core engine.
- 🤝 **Multi-AI Fleet** — peers observe each other live and call each other's models & read-only tools (`peer.chat` / `peer.tool.invoke`) across your network.
- 👁️ **Personal companion** *(optional)* — bidirectional voice, opt-in camera/presence, persistent memory, and 20+ messaging channels.

<br/>

[Quick Start](#quick-start) ·
[In action](#in-action) ·
[Features](#features) ·
[FAQ](docs/faq.md) ·
[Docs](#documentation) ·
[Contributing](#contributing)

</div>

---

## What is Code Buddy?

An open-source, multi-provider AI coding agent with a terminal UI, an HTTP/WebSocket server, and the **Cowork** desktop app — all on one core engine. It reads files, writes code, runs commands, opens PRs, and plans complex tasks across **15 LLM providers** with automatic failover and per-provider circuit breakers. With `buddy login`, a ChatGPT Plus / Pro subscription becomes the flat-fee brain of the whole system — no API keys, no per-token metering. An optional companion layer adds voice, durable memory, opt-in camera perception, and 24/7 background operation.

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

**ChatGPT Pro / Plus login** — `buddy login`, sign in once, then chat with `gpt-5.5` from the terminal. No API key; cost reported as `$0.0000` (flat-fee plan).

<p align="center">
  <img src="docs/screenshots/chatgpt-oauth-login.png" alt="ChatGPT OAuth login flow" width="820"/>
</p>

**Self-audit.** Asked to find a bug in its own integration code, `gpt-5.5` reads `provider-chatgpt-responses.ts`, spots a stale-variable issue (mutated `body.model` not propagated), and proposes the exact fix:

<p align="center">
  <img src="docs/screenshots/self-audit-bug-1.png" alt="Self-audit bug found" width="820"/>
</p>

More desktop demos (Fleet, Autonomy, Companion, …) and captures: [`cowork/readme.md`](cowork/readme.md#demo) · [`docs/screenshots/`](docs/screenshots/README.md).

---

## What's shipped

**1.1.0 GA — these aren't roadmap items.** The captures above are unedited, and the core runs today:

- ✅ **`$0` local coding agent** — a local Ollama model reasons on screen, then calls tools to do real work. *(the demos above)*
- ✅ **ChatGPT Plus/Pro → `gpt-5.5` at `$0`** — `buddy login`, flat-fee, no API key, no per-token metering.
- ✅ **Goal loops (Ralph loop)** — a judge model re-checks completion every turn and auto-continues until done; proven multi-turn on a free local model, with a real in-loop length-truncation recovery ([test](tests/agent/in-loop-recovery.real.test.ts), no mocks).
- ✅ **Multi-AI Fleet** — peers observe each other live and call each other's models & read-only tools (`peer.chat` / `peer.tool.invoke`).
- ✅ **15 providers** with automatic failover and per-provider circuit breakers; **~110 tools**, MCP connectors, and a skills marketplace.
- ✅ **~27K Vitest tests** wired to CI (badge above is the real workflow status).

**Honest about scope:** [Hermes / OpenClaw parity](docs/hermes-openclaw-parity.md) lays out exactly what's shipped, what's externally-gated, and where the edges are — including which messaging channels are full integrations vs. in-process stubs.

---

## Quick Start

```bash
# Install from npm
npm install -g @phuetz/code-buddy

# …or from source (newest features)
git clone https://github.com/phuetz/code-buddy.git
cd code-buddy && npm install && npm run build && npm link   # exposes `buddy` globally
```

Then pick a brain:

```bash
# Option A — free & local: point at a local Ollama, $0
export CODEBUDDY_PROVIDER=ollama
buddy

# Option B — log in with your ChatGPT Plus / Pro subscription (no API key)
buddy login        # opens browser for OAuth → tokens persisted
buddy whoami       # ✅ connected · you@example.com · Plan: pro
buddy              # auto-routes to gpt-5.5 via the Codex backend, cost $0.0000

# Option C — bring your own API key
export GROK_API_KEY=...   # or GEMINI_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY
buddy
```

```bash
buddy --prompt "analyze the codebase structure"   # one-shot task
buddy --yolo                                       # full autonomy
```

See [Getting Started](docs/getting-started.md) for install options, headless mode, sessions, and typical workflows.

---

## Cowork Desktop

Cowork is the desktop cockpit for Code Buddy: chat, tools, traces, workflows, settings, permissions, models, MCP connectors, skills, artifacts, and companion controls — all against the same core agent as the CLI. The Code Buddy settings panel can probe the local backend, start it, discover models, and route turns through the embedded engine or a configured server.

<p align="center">
  <a href="docs/qa/code-buddy-studio/showcase-2026-06-16/cowork-chat-stream.mp4"><img src="docs/qa/code-buddy-studio/showcase-2026-06-16/cowork-chat-stream.gif" alt="Real gpt-5.5 chat streaming in the Cowork desktop app for $0" width="760"/></a>
  <br/>
  <sub>Real <code>gpt-5.5</code> in the Cowork desktop app — the answer streams in, cost <code>$0.0000</code>. <a href="docs/qa/code-buddy-studio/showcase-2026-06-16/cowork-chat-stream.mp4">MP4 →</a></sub>
</p>

<table>
  <tr>
    <td width="50%" align="center"><img src="docs/qa/code-buddy-studio/showcase-2026-06-16/00-welcome.png" alt="Cowork desktop cockpit" width="430"/><br/><sub>Desktop cockpit — menus, sessions, composer</sub></td>
    <td width="50%" align="center"><img src="docs/qa/code-buddy-studio/showcase-2026-06-16/05-onboarding-provider.png" alt="Onboarding — pick a provider" width="430"/><br/><sub>Onboarding — 15 providers, ChatGPT <code>$0</code> or local Ollama</sub></td>
  </tr>
  <tr>
    <td width="50%" align="center"><img src="docs/qa/code-buddy-studio/showcase-2026-06-16/03-fleet-autonomy.png" alt="Fleet and autonomy dashboard" width="430"/><br/><sub>Fleet dispatch · tool-permission posture · Hermes toolsets</sub></td>
    <td width="50%" align="center"><img src="docs/qa/code-buddy-studio/showcase-2026-06-16/02-chat-dark-theme.png" alt="Cowork dark theme" width="430"/><br/><sub>Light &amp; dark themes</sub></td>
  </tr>
</table>

```bash
buddy server --port 3000   # local backend for Cowork, Fleet, and OpenAI-compatible clients
buddy gui                  # launch the desktop app (or: buddy desktop)

# Source dev loop
npm install && npm run build && npm run dev:gui
```

From source, Cowork requires Node.js `>=22` (the root CLI supports Node.js `>=18`). Camera/voice are opt-in and local: snapshots are explicit, percepts are append-only under `.codebuddy/companion/`, and Cowork uses MediaPipe Tasks Vision for face/hand/pose signals. Details: [Cowork Desktop](docs/cowork.md) · [Cowork Architecture](cowork/ARCHITECTURE.md).

---

## Features

| Category | Highlights | Docs |
|:---------|:-----------|:-----|
| **AI Providers** | 15 providers (Grok, Claude, GPT, Gemini, Ollama, LM Studio, AWS Bedrock, Azure, Groq, Together, Fireworks, OpenRouter, vLLM, Copilot, Mistral), circuit breaker, model pairs | [providers.md](docs/providers.md) |
| **Tools** | ~110 tools with RAG selection, multi-strategy edit matching, Codex-style `apply_patch`, streaming, BM25 tool search, code-exec sandbox | [tools-reference.md](docs/tools-reference.md) |
| **Commands** | 190+ slash commands & CLI subcommands (`/goal`, `/dev`, `/pr`, `/lint`, `/switch`, `/think`, `/batch`, …) | [commands.md](docs/commands.md) |
| **Cowork Desktop** | Electron cockpit, embedded engine, backend health/start controls, model settings, permission rules, visual workflows, traces, artifacts, MCP/skills/plugins | [cowork.md](docs/cowork.md), [ARCHITECTURE.md](cowork/ARCHITECTURE.md) |
| **Agents** | Multi-agent orchestration (5-tool API), 8 specialized agents, SWE agent, planning flow, A2A protocol, batch decomposition, agent teams | [agents.md](docs/agents.md) |
| **Goal loops** | `/goal` + `/subgoal` Ralph loop — a judge model re-checks completion every turn and auto-continues until done (turn budget, pause/resume, fail-open); headless `buddy goal`, board goal-mode, peer-session goals | [fleet-guide.md](docs/fleet-guide.md) |
| **Reasoning** | Tree-of-Thought + MCTS (4 depth levels), extended thinking, auto-escalation, `/think` | [reasoning.md](docs/reasoning.md) |
| **Fleet & Autonomy** | Peer-to-peer hub (`peer.chat` / `peer.tool.invoke` / `peer_delegate`), A2A + ACP + MCP interop, 24/7 autonomous service (`buddy autonomy install`), event-driven daemon, free-first local→Tailscale→paid tiering | [fleet-guide.md](docs/fleet-guide.md) |
| **Security** | Guardian Agent (AI risk scoring), OS/Docker/OpenShell sandbox, SSRF guard, secrets vault, write/exec policy, loop & omission detection, output sanitizer | [security.md](docs/security.md) |
| **Context Engine** | Smart compression, tool-output masking, image pruning, transcript repair, pre-compaction flush, JIT context, importance-weighted window | [context-engine.md](docs/context-engine.md) |
| **Channels** | 20+ messaging channels (Telegram, Discord, Slack, WhatsApp, Signal, Teams, Matrix, …), DM pairing, send policy | [channels.md](docs/channels.md) |
| **Companion & Vision** | ChatGPT-backed identity, voice/TTS, proactive check-ins, self-evaluation, mission board; opt-in webcam + MediaPipe face/hand/pose percepts, local face enrollment | [commands.md](docs/commands.md) |
| **Memory & Knowledge** | Persistent + semantic + decision + coding-style memory, cross-session ICM, knowledge-base injection, 40 bundled skills, runtime self-authored skills | [context-engine.md](docs/context-engine.md) |
| **Infrastructure** | HTTP server (OpenAI-compatible), WebSocket gateway, daemon, cron, device nodes, canvas/A2UI, cloud deploy configs, MCP, plugins | [infrastructure.md](docs/infrastructure.md) |
| **Configuration** | Env vars, TOML config with profiles, model-aware limits, per-agent params, i18n (6 locales), personas | [configuration.md](docs/configuration.md) |
| **Git & Code Intel** | Auto-commit (Aider-style), `/pr`, merge-conflict resolver, LSP rename/refactor, bug finder (25+ patterns, 6 langs), OpenAPI generator, IDE extensions | [development.md](docs/development.md) |

---

## Documentation

| Document | Description |
|:---------|:------------|
| [Getting Started](docs/getting-started.md) | Prerequisites, install, first run, headless mode, sessions |
| [Providers](docs/providers.md) | All 15 providers, connection profiles, model pairs, circuit breaker |
| [Tools Reference](docs/tools-reference.md) | Tool categories, RAG selection, edit matching, `apply_patch`, streaming |
| [Commands](docs/commands.md) | All slash commands, CLI subcommands, companion commands, global flags |
| [Cowork Desktop](docs/cowork.md) · [Architecture](cowork/ARCHITECTURE.md) · [README](cowork/readme.md) | Desktop overview, install, source build, sandbox modes, internals |
| [Agents](docs/agents.md) · [Reasoning](docs/reasoning.md) | Orchestration, SWE agent, planning flow, A2A; thinking, ToT, MCTS |
| [Fleet Guide](docs/fleet-guide.md) | Multi-AI hub, peer-rpc methods, env-driven auto-detect, Tailscale labs |
| [Security](docs/security.md) · [Context Engine](docs/context-engine.md) | Permission modes, Guardian, sandboxing, secrets; compression, JIT context |
| [Channels](docs/channels.md) · [Configuration](docs/configuration.md) | 20+ channels, DM pairing; env vars, TOML, model limits |
| [Infrastructure](docs/infrastructure.md) · [Deployment](docs/deployment.md) | Server, gateway, daemon, cron; systemd, Docker, Kubernetes, upgrades |
| [Development](docs/development.md) | Build, test, architecture, conventions, adding tools |
| [Hermes / OpenClaw Parity](docs/hermes-openclaw-parity.md) | Where Code Buddy stands vs Hermes Agent & OpenClaw |

---

## Contributing

```bash
git clone https://github.com/phuetz/code-buddy.git
cd code-buddy && npm install
npm run dev          # development mode
npm run validate     # lint + typecheck + test (run before committing) — 27K+ Vitest tests
```

See [Development](docs/development.md) for architecture and coding conventions, and [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow.

---

## License

MIT — see [LICENSE](LICENSE).

---

<div align="center">

**[Report Bug](https://github.com/phuetz/code-buddy/issues)** ·
**[Request Feature](https://github.com/phuetz/code-buddy/discussions)** ·
**[Star on GitHub ⭐](https://github.com/phuetz/code-buddy)**

<sub>Multi-AI: Grok · Claude · ChatGPT · Gemini · LM Studio · Ollama · AWS Bedrock · Azure · Groq · Together · Fireworks · OpenRouter · vLLM · Copilot · Mistral</sub>

</div>
