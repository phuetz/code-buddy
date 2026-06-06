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
  <img src="https://img.shields.io/badge/Tests-27%2C334-00d26a?style=flat-square&logo=jest" alt="Tests"/>
  <img src="https://img.shields.io/badge/Coverage-85%25-48dbfb?style=flat-square" alt="Coverage"/>
  <img src="https://img.shields.io/badge/Build-passing-00d26a?style=flat-square" alt="Build"/>
</p>

<br/>

**A multi-AI terminal agent that writes code, runs commands, searches the web, talks to you, and manages your projects -- from your terminal, your phone, or running 24/7 in the background.**

**Now with a [Multi-AI Fleet Hub](docs/fleet-guide.md)** — multiple Code Buddy peers can observe each other's events live and invoke each other's LLMs via `/fleet send peer.chat`. Pilot local Ollama LLMs from any peer in your Tailscale network for free coding/reasoning. *(Phase (d).1 → (d).16a, May 2026.)*

**Auto-memory writeback** — the agent persists what it learns (preferences, decisions, gotchas) to `.codebuddy/CODEBUDDY_MEMORY.md` across sessions. View with `/memory recent`. `buddy --init` also generates an `AGENTS.md` at the project root for cross-CLI compatibility (read by Claude Code, Gemini CLI, Cursor, Codex). *(rc.2, May 2026.)*

<br/>

[Quick Start](#quick-start) |
[Features](#features) |
[Documentation](#documentation) |
[Contributing](#contributing)

</div>

---

## What is Code Buddy?

Code Buddy is an open-source multi-provider AI coding agent that runs in your terminal. It supports **15 LLM providers** with automatic failover and per-provider circuit breakers. It works as both a **development tool** (reads files, writes code, runs commands, creates PRs, plans complex tasks) and a **personal assistant** (voice conversation, memory, screen monitoring, push notifications via 20+ messaging channels, 24/7 background operation).

---

## In action

**ChatGPT Pro / Plus subscription login (Phase d.23+)** — `buddy login`, sign in once with your ChatGPT account, then chat with `gpt-5.5` directly from the terminal. No API key, cost reported as `$0.0000` (flat-fee plan).

Public OAuth screenshots are intentionally omitted: the browser callback and
terminal success view can include account claims or short-lived authorization
material. See [`docs/screenshots/`](docs/screenshots/README.md) for the
redacted flow notes.

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
# Install
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

See [Getting Started](docs/getting-started.md) for installation options, headless mode, session management, and typical workflows. The ChatGPT Codex OAuth flow is documented with public-safe notes in [`docs/screenshots/`](docs/screenshots/README.md).

---

## Features

| Category | Highlights | Docs |
|:---------|:-----------|:-----|
| **AI Providers** | 15 providers (Grok, Claude, GPT, Gemini, Ollama, LM Studio, AWS Bedrock, Azure, Groq, Together, Fireworks, OpenRouter, vLLM, Copilot, Mistral), circuit breaker, model pairs | [providers.md](docs/providers.md) |
| **Tools** | ~110 tools with RAG selection, multi-strategy edit matching, Codex-style apply_patch, streaming, BM25 tool search, code exec sandbox | [tools-reference.md](docs/tools-reference.md) |
| **Commands** | 190+ slash commands, CLI subcommands (`/dev`, `/pr`, `/lint`, `/switch`, `/think`, `/batch`, `/watch`, `/conflicts`, `/vulns`, `/replace`) | [commands.md](docs/commands.md) |
| **Agents** | Multi-agent orchestration (5-tool API), 8 specialized agents, SWE agent, planning flow, A2A protocol, batch decomposition, agent teams | [agents.md](docs/agents.md) |
| **Reasoning** | Tree-of-Thought + MCTS (4 depth levels), extended thinking, auto-escalation, `/think` command | [reasoning.md](docs/reasoning.md) |
| **Security** | Guardian Agent (AI risk scoring), OS/Docker/OpenShell sandbox, SSRF guard, secrets vault, write policy, exec policy, loop detection, omission detection, output sanitizer | [security.md](docs/security.md) |
| **Channels** | 20+ messaging channels (Telegram, Discord, Slack, WhatsApp, Signal, Teams, Matrix, IRC, and more), DM pairing, send policy | [channels.md](docs/channels.md) |
| **Context Engine** | Smart compression, tool output masking, image pruning, transcript repair, pre-compaction flush, restorable compression, JIT context, importance-weighted window | [context-engine.md](docs/context-engine.md) |
| **Infrastructure** | HTTP server (OpenAI-compatible), WebSocket gateway, daemon mode, cron, device nodes, canvas/A2UI, 6 cloud deploy configs, MCP, plugins | [infrastructure.md](docs/infrastructure.md) |
| **Configuration** | Env vars, TOML config with profiles, model-aware limits, per-agent params, i18n (6 locales), personas | [configuration.md](docs/configuration.md) |
| **Development** | TypeScript strict, Vitest (27,334 tests), ESM, middleware pipeline, facade architecture | [development.md](docs/development.md) |

### Additional Capabilities

- **Voice**: 7 TTS providers, wake word detection, voice-to-code pipeline, hands-free conversation
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
| [Providers](docs/providers.md) | All 15 providers, connection profiles, model pairs, circuit breaker |
| [Tools Reference](docs/tools-reference.md) | Tool categories, RAG selection, edit matching, apply_patch, streaming |
| [Commands](docs/commands.md) | All slash commands, CLI subcommands, global flags |
| [Agents](docs/agents.md) | Multi-agent orchestration, roles, SWE agent, planning flow, A2A |
| [Reasoning](docs/reasoning.md) | Extended thinking, Tree-of-Thought, MCTS, /think command |
| [Security](docs/security.md) | Permission modes, Guardian Agent, sandboxing, SSRF, secrets vault |
| [Channels](docs/channels.md) | 20+ messaging channels, DM pairing, send policy |
| [Context Engine](docs/context-engine.md) | Compression, tool output masking, JIT context, pre-compaction flush |
| [Infrastructure](docs/infrastructure.md) | HTTP server, WebSocket gateway, daemon, cron, deploy, plugins |
| [Fleet Guide](docs/fleet-guide.md) | **Multi-AI hub** — `/fleet listen` + `/fleet send peer.chat`, env-driven multi-provider auto-detect, Tailscale lab examples |
| [Configuration](docs/configuration.md) | Environment variables, TOML config, project settings, model limits |
| [Development](docs/development.md) | Build, test, architecture, coding conventions, adding tools |

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
