# @phuetz/code-buddy — Documentation

> Source-available multi-provider AI coding agent for the terminal. Supports Grok, Claude, ChatGPT, Gemini, Ollama and LM Studio with repository tools, multi-channel messaging, skills system, and OpenClaw-inspired architecture.

*Generated: 2026-03-28*

## Where to start?

| I want to... | Go to... |
|-------------|----------|
| Understand the project | [Overview](./1-overview.md) |
| Get started quickly | [Getting Started](./1-1-getting-started.md) |
| Understand the architecture | [Architecture](./2-architecture.md) |
| Configure the project | [Configuration](./25-configuration.md) |
| Understand security | [Security](./24-security.md) |
| Use the CLI or API | [API Reference](./26-api-reference.md) |
| Fix an issue | [Troubleshooting](./28-troubleshooting.md) |

## Project at a Glance

| Metric | Value |
|--------|-------|
| Modules | 1 210 |
| Functions | 0 |
| Relationships | 8 683 |

## All Sections

- [1. Overview](./1-overview.md)
  - [1.1. Getting Started](./1-1-getting-started.md)
  - [1.2. Key Concepts](./1-2-key-concepts.md)
- [2. Architecture](./2-architecture.md)
- [3. Commands + utils](./3-commands-utils.md)
- [4. Agent + utils](./4-agent-utils.md)
- [5. Tools](./5-tools.md)
- [6. Agent + security](./6-agent-security.md)
- [7. Context + agent](./7-context-agent.md)
- [8. Channels](./8-channels.md)
- [9. Codebuddy](./9-codebuddy.md)
- [10. Commands](./10-commands.md)
- [11. Tools (Unified-vfs-router)](./11-tools-unified-vfs-router-.md)
- [12. Agent](./12-agent.md)
- [13. Database + analytics](./13-database-analytics.md)
- [14. Agent + persistence](./14-agent-persistence.md)
- [15. Agent + utils (Todo-tracker)](./15-agent-utils-todo-tracker-.md)
- [16. Plugins](./16-plugins.md)
- [17. Ui](./17-ui.md)
- [18. Logger](./18-logger.md)
- [19. Types](./19-types.md)
- [20. Client](./20-client.md)
- [21. Knowledge graph](./21-knowledge-graph.md)
- [22. Unified vfs router](./22-unified-vfs-router.md)
- [23. Code Quality Metrics](./23-metrics.md)
- [24. Security](./24-security.md)
- [25. Configuration](./25-configuration.md)
- [26. API Reference](./26-api-reference.md)
- [27. Testing](./27-testing.md)
- [28. Troubleshooting](./28-troubleshooting.md)

---

# @phuetz/code-buddy v0.5.0

<details>
<summary>Relevant source files</summary>

- `src/utils/logger.ts`
- `src/types.ts`
- `src/codebuddy/client.ts`
- `src/knowledge/knowledge-graph.ts`
- `src/services/vfs/unified-vfs-router.ts`

</details>

> Source-available multi-provider AI coding [agent](./12-agent.md) for the terminal. Supports Grok, Claude, ChatGPT, Gemini, Ollama and LM Studio with [repository tools](./5-tools.md), multi-channel messaging, skills system, and OpenClaw-inspired [architecture](./2-architecture.md).

| Metric | Value |
|--------|-------|
| [Modules](./3-commands-utils.md#modules) | 1210 |
| Classes | 0 |
| Functions | 0 |
| Relationships | 8 683 |

## Core Modules

| Module | PageRank | Functions |
|--------|----------|-----------|
| `src/utils/logger` | 1.000 | 0 |
| `src/types` | 0.200 | 0 |
| `src/codebuddy/client` | 0.106 | 0 |
| `src/knowledge/knowledge-graph` | 0.069 | 0 |
| `src/services/vfs/unified-vfs-router` | 0.064 | 0 |
| `src/codebuddy/tool-definitions/types` | 0.053 | 0 |
| `src/agent/codebuddy-agent` | 0.052 | 0 |
| `src/channels` | 0.036 | 0 |
| `src/optimization/latency-optimizer` | 0.031 | 0 |
| `src/commands/handlers/branch-handlers` | 0.031 | 0 |
| `src/config/constants` | 0.031 | 0 |
| `src/ui/context/theme-context` | 0.031 | 0 |
| `src/channels/core` | 0.031 | 0 |
| `src/database/schema` | 0.030 | 0 |
| `src/workspace/workspace-isolation` | 0.030 | 0 |

## Technology Stack

- Language: typescript
- Framework: express
- [Dependencies](./20-client.md#dependencies): 35

## Inspired-By Architecture

- **Guardian Sub-Agent** (Codex) (`src/security/guardian-agent.ts`) — AI-powered automatic approval reviewer in `src/security/guardian-agent.ts`. Risk scoring 0-100: auto-approves < 80, prompts 80-90, denies >= 90. Always-safe set (no LLM needed): `read_file`, `grep`, `
- **Ghost Snapshots** (Codex) (`src/checkpoints/ghost-snapshot.ts`)
- **apply_patch Format** (Codex) (`src/tools/apply-patch.ts`) — *** Begin Patch
- **Multi-Agent Tool Surface** (Codex) (`src/agent/multi-agent/agent-tools.ts`) — Max 10 concurrent agents. Completion watchers auto-notify parents. Nickname pool (24 names) with generation suffixes.
- **Code Exec** (Codex) (`src/tools/code-exec-tool.ts`)
- **Memory Consolidation** (Codex) (`src/memory/memory-consolidation.ts`) — - **Phase 1**: Extract memories from user messages (preference/pattern/context/decision signals)
- **OpenManus Architecture** (OpenManus) (`src/agent/state-machine.ts`) — OpenManus-compatible agent framework with 5 subsystems:
- **Todo tracking** (Codex) (`src/agent/todo-tracker.ts`) — Manus-style attention bias, injected at END of each turn
- **apply_patch** (Codex) (`src/tools/apply-patch.ts`) — Codex-style `*** Begin Patch` format; 4-pass seek_sequence (exact→trim→full-trim→Unicode); Add/Delete/Update/Move file ops
- **State Machine** (OpenManus) (`src/agent/state-machine.ts`) — OpenManus-compatible agent states (IDLE/RUNNING/THINKING/ACTING/FINISHED/ERROR), stuck detection, perturbation recovery

## Key Subsystems

| Subsystem | Location | Notes |
|-----------|----------|-------|
| Daemon + cron | `src/daemon/` | PID file, health monitor, heartbeat engine, daily reset at 04:00, idle timeout, session maintenance (prune/rotate/cap), cross-platform service installer (launchd/systemd/schtasks) |
| Channels | `src/channels/` | Telegram, Discord, Slack, WhatsApp, Signal, Teams, Matrix, WebChat, IRC, Feishu/Lark, Synology Chat, LINE, Nostr, Zalo, Mattermost, Nextcloud Talk, Twilio Voice, iMessage, Twitch, Gmail |
| Pro channel features | `src/channels/pro/` | Lazy-loaded: scoped auth, diff-first, CI watcher, run tracker |
| Skills | `src/skills/` | Registry + hub marketplace; 40 bundled SKILL.md files; `$ARGUMENTS[N]` variable resolution, `!`cmd`` bash injection, `context: fork`, `disable-model-invocation` frontmatter |
| Starter Packs | `src/skills/starter-packs.ts` | 34 bundled SKILL.md guides; `/starter` command; empty-project detection in workflow-guard |
| Identity | `src/identity/` | SOUL.md/USER.md/AGENTS.md, hot-reload, prompt injection |
| Knowledge | `src/knowledge/` | Knowledge.md loading, injected as `<knowledge>` block |
| Lessons | `src/agent/lessons-tracker.ts` | PATTERN/RULE/CONTEXT/INSIGHT, project + global `.codebuddy/lessons.md` |
| Todo tracking | `src/agent/todo-tracker.ts` | Manus-style attention bias, injected at END of each turn |
| Security | `src/security/` | write-policy, SSRF guard, bash-parser, shell-env-policy, skill-scanner, guardian-agent, policy-amendments; declarative rules support gitignore syntax: `Read(~/Documents/*.pdf)`, `Edit(src/**,!src/tests/**)` |
| Guardian Agent | `src/security/guardian-agent.ts` | AI-powered automatic approval reviewer; risk scoring 0-100; auto-approves < 80, denies >= 90; 90s timeout, fail-closed |
| Policy Amendments | `src/security/policy-amendments.ts` | Suggests allow rules when commands are blocked; persists to `.codebuddy/rules/`; command canonicalization (strips shell wrappers) |
| Ghost Snapshots | `src/checkpoints/ghost-snapshot.ts` | Git-based undo: auto-commits workspace before each turn; shadow refs in `refs/codebuddy/ghost/`; max 50 snapshots |
| Permission Requests | `src/tools/request-permissions-tool.ts` | Dynamic permission escalation mid-session; turn-scoped or session-scoped grants; least-privilege model |
| BM25 Tool Search | `src/tools/tool-search.ts` | BM25/TF-IDF search over tool metadata; `tool_search` tool for discovering relevant tools from large MCP sets |

## [Getting Started](./1-1-getting-started.md)

```bash
npm install
npm run build
npm run dev
npm start
```

## Summary

**Overview** covers:
1. **Core Modules**
2. **Technology Stack**
3. **Inspired-By Architecture**
4. **Key Subsystems**
5. **Getting Started**


---

**See also:** [Getting Started](./1-1-getting-started.md) · [Architecture](./2-architecture.md)


---
[Next: Getting Started →](./1-1-getting-started.md)


---

# Getting Started

<details>
<summary>Relevant source files</summary>

- `src/advanced/session-replay.ts`
- `src/agent/agent-loader.ts`
- `src/agent/architect-mode.ts`

</details>

## Prerequisites

- Node.js 18+ runtime

## Installation

```bash
cd @phuetz/code-buddy
npm install
```

## First Run

```bash
npm run dev
```

## Available Scripts

| Script | Command |
|--------|---------|
| `npm run build` | `tsc` |
| `npm run build:bun` | `bun run tsc` |
| `npm run build:watch` | `tsc --watch` |
| `npm run clean` | `rm -rf dist coverage .nyc_output *.tsbuildinfo` |
| `npm run dev` | `bun run src/index.ts` |
| `npm run dev:node` | `tsx src/index.ts` |
| `npm run start` | `node dist/index.js` |
| `npm run start:bun` | `bun run dist/index.js` |
| `npm run test` | `vitest run` |
| `npm run test:watch` | `vitest` |
| `npm run test:coverage` | `vitest run --coverage` |
| `npm run lint` | `eslint . --ext .js,.jsx,.ts,.tsx` |
| `npm run lint:fix` | `eslint . --ext .js,.jsx,.ts,.tsx --fix` |
| `npm run format` | `prettier --write "src/**/*.{ts,tsx,js,jsx,json,md}"` |
| `npm run format:check` | `prettier --check "src/**/*.{ts,tsx,js,jsx,json,md}"` |

## Summary

**Getting Started** covers:
1. **Prerequisites**
2. **Installation**
3. **First Run**
4. **Available Scripts**


---

**See also:** [Overview](./1-overview.md)


**Referenced by:** [Overview](./1-overview.md)



---

# Key Concepts

- **[logger](./18-logger.md)** — Core module (0 functions, PageRank 1.000)
- **[types](./19-types.md)** — Core module (0 functions, PageRank 0.200)
- **[client](./20-client.md)** — Core module (0 functions, PageRank 0.106)
- **knowledge-graph** — Core module (0 functions, PageRank 0.069)
- **unified-vfs-router** — Core module (0 functions, PageRank 0.064)
- **types** — Core module (0 functions, PageRank 0.053)
- **[codebuddy](./9-codebuddy.md)-[agent](./12-agent.md)** — Core module (0 functions, PageRank 0.052)
- **[channels](./8-channels.md)** — Core module (0 functions, PageRank 0.036)
- **latency-optimizer** — Core module (0 functions, PageRank 0.031)
- **branch-handlers** — Core module (0 functions, PageRank 0.031)
- **constants** — Core module (0 functions, PageRank 0.031)
- **theme-context** — Core module (0 functions, PageRank 0.031)
- **core** — Core module (0 functions, PageRank 0.031)
- **schema** — Core module (0 functions, PageRank 0.030)
- **workspace-isolation** — Core module (0 functions, PageRank 0.030)

## Summary

This page documents **Key Concepts**: core terminology and concepts.


---

**See also:** [Overview](./1-overview.md) · [Architecture](./2-architecture.md)



---

# Architecture

<details>
<summary>Relevant source files</summary>

- `src/utils/logger.ts`
- `src/types.ts`
- `src/codebuddy/client.ts`
- `src/knowledge/knowledge-graph.ts`
- `src/services/vfs/unified-vfs-router.ts`
- `src/codebuddy/tool-definitions/types.ts`
- `src/agent/codebuddy-agent.ts`
- `src/channels.ts`

</details>

Architecture type: **plugin-based**

## Layers

| Layer | Modules |
|-------|---------|
| `src/agent` | 149 |
| `src/tools` | See the tool registry; no inventory total claimed |
| `src/commands` | 90 |
| `src/utils` | 73 |
| `src/context` | 53 |
| `src/channels` | 49 |
| `src/ui` | 49 |
| `src/security` | 44 |
| `src/knowledge` | 28 |
| `src/server` | 28 |
| `src/codebuddy` | 26 |
| `src/config` | 26 |
| `src/plugins` | 23 |
| `src/hooks` | 20 |
| `src/integrations` | 20 |

## Entry Points

- `src/advanced/session-replay`
- `src/agent/agent-loader`
- `src/agent/architect-mode`
- `src/agent/background-tasks`
- `src/agent/cache-trace`

## Layer Diagram

```mermaid
graph TD
  "agent"["agent (149)"]
  "tools"["tool registry"]
  "commands"["commands (90)"]
  "utils"["utils (73)"]
  "context"["context (53)"]
  "channels"["channels (49)"]
  "ui"["ui (49)"]
  "security"["security (44)"]
  "agent" --> "tools"
  "tools" --> "commands"
  "commands" --> "utils"
  "utils" --> "context"
  "context" --> "channels"
  "channels" --> "ui"
  "ui" --> "security"
```

## Summary

**Architecture** covers:
1. **Layers**
2. **Entry Points**
3. **Layer Diagram**


---

**See also:** [Overview](./1-overview.md)


**Referenced by:** [Overview](./1-overview.md) · [Code Quality Metrics](./23-metrics.md)



---

# Commands + utils

<details>
<summary>Relevant source files</summary>

- `src/agent/codebuddy-agent.ts`
- `src/config/constants.ts`
- `src/utils/base-url.ts`
- `src/utils/model-utils.ts`
- `src/utils/settings-manager.ts`
- `src/utils/confirmation-service.ts`
- `src/commands/slash/types.ts`
- `src/server/middleware.ts`

</details>

190 modules in the commands + utils subsystem

## Module [Dependencies](./20-client.md#dependencies)

```mermaid
graph TD
  "codebuddy-agent" --> "settings-manager"
  "settings-manager" --> "base-url"
```

## Modules

| Module | Functions | Classes | Imported By |
|--------|-----------|---------|-------------|
| `src/agent/codebuddy-agent` | 0 | 0 | 41 |
| `src/config/constants` | 0 | 0 | 10 |
| `src/utils/base-url` | 0 | 0 | 2 |
| `src/utils/model-utils` | 0 | 0 | 2 |
| `src/utils/settings-manager` | 0 | 0 | 13 |
| `src/utils/confirmation-service` | 0 | 0 | 21 |
| `src/commands/slash/types` | 0 | 0 | 3 |
| `src/server/middleware` | 0 | 0 | 10 |
| `src/utils/glob-utils` | 0 | 0 | 5 |
| `src/commands/slash-commands` | 0 | 0 | 7 |

## Key Functions


## Cross-Subsystem Dependencies

**Imported by:** `src/commands/` (38), `src/server/` (16), `src/tools/` (13), `src/ui/` (7), `src/mcp/` (5), `src/app/` (3), `src/cli/` (3), `src/hooks/` (3)
**Depends on:** `src/agent/` (9), `src/utils/` (7), `src/security/` (3), `src/codebuddy/` (2), `src/skills/` (2), `src/analytics/` (2), `src/persistence/` (1), `src/types/` (1)

## Summary

**Commands + utils** covers:
1. **Module Dependencies**
2. **Modules**
3. **Key Functions**
4. **Cross-Subsystem Dependencies**


---

**See also:** [Agent + utils](./4-agent-utils.md) · [Tools](./5-tools.md) · [Agent + security](./6-agent-security.md) · [Context + agent](./7-context-agent.md)


**Referenced by:** [Overview](./1-overview.md) · [Agent + utils](./4-agent-utils.md) · [Tools](./5-tools.md) · [Agent + security](./6-agent-security.md) · [Context + agent](./7-context-agent.md) · [Channels](./8-channels.md)



---

# Agent + utils

<details>
<summary>Relevant source files</summary>

- `src/utils/logger.ts`
- `src/workflows/types.ts`
- `src/utils/session-enhancements.ts`
- `src/workflows/state-manager.ts`
- `src/workflows/step-manager.ts`
- `src/advanced/session-replay.ts`
- `src/agent/agent-loader.ts`
- `src/agent/background-tasks.ts`

</details>

145 [modules](./3-commands-utils.md#modules) in the agent + utils subsystem

## [Module Dependencies](./3-commands-utils.md#module-dependencies)

```mermaid
graph TD
  "session-enhancements" --> "logger"
  "step-manager" --> "logger"
  "step-manager" --> "types"
  "session-replay" --> "logger"
```

## Modules

| Module | Functions | Classes | Imported By |
|--------|-----------|---------|-------------|
| `src/utils/logger` | 0 | 0 | 481 |
| `src/workflows/types` | 0 | 0 | 1 |
| `src/utils/session-enhancements` | 0 | 0 | 1 |
| `src/workflows/state-manager` | 0 | 0 | 1 |
| `src/workflows/step-manager` | 0 | 0 | 1 |
| `src/advanced/session-replay` | 0 | 0 | 0 |
| `src/agent/agent-loader` | 0 | 0 | 0 |
| `src/agent/background-tasks` | 0 | 0 | 0 |
| `src/agent/cache-trace` | 0 | 0 | 0 |
| `src/agent/definitions/agent-definition-loader` | 0 | 0 | 0 |

## [Key Functions](./3-commands-utils.md#key-functions)


## [Cross-Subsystem Dependencies](./3-commands-utils.md#cross-subsystem-dependencies)

**Imported by:** `src/agent/` (56), `src/tools/` (46), `src/context/` (30), `src/utils/` (27), `src/channels/` (25), `src/security/` (23), `src/commands/` (20), `src/plugins/` (18)

## Summary

**Agent + utils** covers:
1. **Module Dependencies**
2. **Modules**
3. **Key Functions**
4. **Cross-Subsystem Dependencies**


---

**See also:** [Commands + utils](./3-commands-utils.md)



---

# Tools

<details>
<summary>Relevant source files</summary>

- `src/types.ts`
- `src/knowledge/knowledge-graph.ts`
- `src/tools/registry/types.ts`
- `src/knowledge/graph-pagerank.ts`
- `src/tools.ts`
- `src/tools/base-tool.ts`
- `src/knowledge/community-detection.ts`
- `src/knowledge/knowledge-manager.ts`

</details>

126 [modules](./3-commands-utils.md#modules) in the tools subsystem

## [Module Dependencies](./3-commands-utils.md#module-dependencies)

```mermaid
graph TD
  "knowledge-graph" --> "graph-pagerank"
  "base-tool" --> "types"
  "community-detection" --> "knowledge-graph"
```

## Modules

| Module | Functions | Classes | Imported By |
|--------|-----------|---------|-------------|
| `src/types` | 0 | 0 | 155 |
| `src/knowledge/knowledge-graph` | 0 | 0 | 33 |
| `src/tools/registry/types` | 0 | 0 | 38 |
| `src/knowledge/graph-pagerank` | 0 | 0 | 2 |
| `src/tools` | 0 | 0 | 8 |
| `src/tools/base-tool` | 0 | 0 | 6 |
| `src/knowledge/community-detection` | 0 | 0 | 3 |
| `src/knowledge/knowledge-manager` | 0 | 0 | 2 |
| `src/knowledge/scanners` | 0 | 0 | 2 |
| `src/security/dependency-vuln-scanner` | 0 | 0 | 2 |

## [Key Functions](./3-commands-utils.md#key-functions)


## [Cross-Subsystem Dependencies](./3-commands-utils.md#cross-subsystem-dependencies)

**Imported by:** `src/tools/` (151), `src/agent/` (31), `src/knowledge/` (19), `src/commands/` (8), `src/context/` (8), `src/docs/` (6), `src/input/` (3), `src/hooks/` (2)
**Depends on:** `src/utils/` (3), `src/knowledge/` (1)

## Summary

**Tools** covers:
1. **Module Dependencies**
2. **Modules**
3. **Key Functions**
4. **Cross-Subsystem Dependencies**


---

**See also:** [Commands + utils](./3-commands-utils.md)


**Referenced by:** [Overview](./1-overview.md) · [Testing](./27-testing.md)



---

# Agent + security

<details>
<summary>Relevant source files</summary>

- `src/optimization/latency-optimizer.ts`
- `src/utils/cost-tracker.ts`
- `src/utils/token-counter.ts`
- `src/mcp/transports.ts`
- `src/checkpoints/checkpoint-manager.ts`
- `src/plugins/sandbox-worker.ts`
- `src/codebuddy/tools.ts`
- `src/errors.ts`

</details>

55 [modules](./3-commands-utils.md#modules) in the agent + security subsystem

## [Module Dependencies](./3-commands-utils.md#module-dependencies)

```mermaid
graph TD
  "errors"
  "checkpoint-manager"
  "token-counter"
  "tools"
```

## Modules

| Module | Functions | Classes | Imported By |
|--------|-----------|---------|-------------|
| `src/optimization/latency-optimizer` | 0 | 0 | 3 |
| `src/utils/cost-tracker` | 0 | 0 | 7 |
| `src/utils/token-counter` | 0 | 0 | 8 |
| `src/mcp/transports` | 0 | 0 | 2 |
| `src/checkpoints/checkpoint-manager` | 0 | 0 | 9 |
| `src/plugins/sandbox-worker` | 0 | 0 | 1 |
| `src/codebuddy/tools` | 0 | 0 | 8 |
| `src/errors` | 0 | 0 | 10 |
| `src/optimization/model-routing` | 0 | 0 | 6 |
| `src/utils/json-validator` | 0 | 0 | 1 |

## [Key Functions](./3-commands-utils.md#key-functions)


## [Cross-Subsystem Dependencies](./3-commands-utils.md#cross-subsystem-dependencies)

**Imported by:** `src/agent/` (30), `src/commands/` (6), `src/ui/` (4), `src/optimization/` (2), `src/services/` (2), `src/infrastructure/` (2), `src/mcp/` (2), `src/tools/` (2)
**Depends on:** `src/utils/` (3), `src/mcp/` (2), `src/tools/` (2), `src/database/` (1), `src/types/` (1), `src/codebuddy/` (1), `src/plugins/` (1)

## Summary

**Agent + security** covers:
1. **Module Dependencies**
2. **Modules**
3. **Key Functions**
4. **Cross-Subsystem Dependencies**


---

**See also:** [Commands + utils](./3-commands-utils.md)



---

# Context + agent

<details>
<summary>Relevant source files</summary>

- `src/codebuddy/client.ts`
- `src/persistence/conversation-branches.ts`
- `src/utils/retry.ts`
- `src/config/model-tools.ts`
- `src/utils/rate-limit-display.ts`
- `src/providers/circuit-breaker.ts`
- `src/tools/types.ts`
- `src/context/context-engine.ts`

</details>

48 [modules](./3-commands-utils.md#modules) in the context + agent subsystem

## [Module Dependencies](./3-commands-utils.md#module-dependencies)

```mermaid
graph TD
  "client" --> "model-tools"
  "client" --> "retry"
  "client" --> "circuit-breaker"
  "client" --> "rate-limit-display"
  "context-engine" --> "client"
  "types" --> "client"
  "conversation-branches" --> "client"
```

## Modules

| Module | Functions | Classes | Imported By |
|--------|-----------|---------|-------------|
| `src/codebuddy/client` | 0 | 0 | 66 |
| `src/persistence/conversation-branches` | 0 | 0 | 2 |
| `src/utils/retry` | 0 | 0 | 3 |
| `src/config/model-tools` | 0 | 0 | 3 |
| `src/utils/rate-limit-display` | 0 | 0 | 2 |
| `src/providers/circuit-breaker` | 0 | 0 | 1 |
| `src/tools/types` | 0 | 0 | 4 |
| `src/context/context-engine` | 0 | 0 | 5 |
| `src/context/token-counter` | 0 | 0 | 9 |
| `src/context/types` | 0 | 0 | 3 |

## [Key Functions](./3-commands-utils.md#key-functions)


## [Cross-Subsystem Dependencies](./3-commands-utils.md#cross-subsystem-dependencies)

**Imported by:** `src/agent/` (32), `src/context/` (22), `src/commands/` (7), `src/tools/` (7), `src/streaming/` (3), `src/cache/` (2), `src/lsp/` (2), `src/optimization/` (2)
**Depends on:** `src/utils/` (7)

## Summary

**Context + agent** covers:
1. **Module Dependencies**
2. **Modules**
3. **Key Functions**
4. **Cross-Subsystem Dependencies**


---

**See also:** [Commands + utils](./3-commands-utils.md)



---

# Channels

<details>
<summary>Relevant source files</summary>

- `src/channels/core.ts`
- `src/channels/pro/types.ts`
- `src/channels/pro/scoped-auth.ts`
- `src/channels/reconnection-manager.ts`
- `src/channels/pro/run-tracker.ts`
- `src/channels/pro/ci-watcher.ts`
- `src/channels/pro/diff-first.ts`
- `src/channels/pro/enhanced-commands.ts`

</details>

40 [modules](./3-commands-utils.md#modules) in the channels subsystem

## [Module Dependencies](./3-commands-utils.md#module-dependencies)

```mermaid
graph TD
  "scoped-auth" --> "types"
  "run-tracker" --> "types"
  "ci-watcher" --> "scoped-auth"
```

## Modules

| Module | Functions | Classes | Imported By |
|--------|-----------|---------|-------------|
| `src/channels/core` | 0 | 0 | 24 |
| `src/channels/pro/types` | 0 | 0 | 6 |
| `src/channels/pro/scoped-auth` | 0 | 0 | 4 |
| `src/channels/reconnection-manager` | 0 | 0 | 6 |
| `src/channels/pro/run-tracker` | 0 | 0 | 4 |
| `src/channels/pro/ci-watcher` | 0 | 0 | 4 |
| `src/channels/pro/diff-first` | 0 | 0 | 2 |
| `src/channels/pro/enhanced-commands` | 0 | 0 | 2 |
| `src/channels/pro/run-commands` | 0 | 0 | 2 |
| `src/channels/pro/pro-features` | 0 | 0 | 1 |

## [Key Functions](./3-commands-utils.md#key-functions)


## [Cross-Subsystem Dependencies](./3-commands-utils.md#cross-subsystem-dependencies)

**Imported by:** `src/channels/` (41)
**Depends on:** `src/channels/` (4), `src/utils/` (2)

## Summary

**Channels** covers:
1. **Module Dependencies**
2. **Modules**
3. **Key Functions**
4. **Cross-Subsystem Dependencies**


---

**See also:** [Commands + utils](./3-commands-utils.md)


**Referenced by:** [Key Concepts](./1-2-key-concepts.md) · [Testing](./27-testing.md)



---

# Codebuddy

<details>
<summary>Relevant source files</summary>

- `src/codebuddy/tool-definitions/types.ts`
- `src/codebuddy/tool-definitions/advanced-tools.ts`
- `src/codebuddy/tool-definitions/agent-tools.ts`
- `src/codebuddy/tool-definitions/batch-tools.ts`
- `src/codebuddy/tool-definitions/browser-tools.ts`
- `src/codebuddy/tool-definitions/bug-finder-tools.ts`
- `src/codebuddy/tool-definitions/canvas-tools.ts`
- `src/codebuddy/tool-definitions/codebase-replace-tools.ts`

</details>

24 [modules](./3-commands-utils.md#modules) in the codebuddy subsystem

## [Module Dependencies](./3-commands-utils.md#module-dependencies)

```mermaid
graph TD
  "advanced-tools" --> "types"
  "agent-tools" --> "types"
  "batch-tools" --> "types"
  "browser-tools" --> "types"
  "bug-finder-tools" --> "types"
```

## Modules

| Module | Functions | Classes | Imported By |
|--------|-----------|---------|-------------|
| `src/codebuddy/tool-definitions/types` | 0 | 0 | 23 |
| `src/codebuddy/tool-definitions/advanced-tools` | 0 | 0 | 0 |
| `src/codebuddy/tool-definitions/agent-tools` | 0 | 0 | 0 |
| `src/codebuddy/tool-definitions/batch-tools` | 0 | 0 | 0 |
| `src/codebuddy/tool-definitions/browser-tools` | 0 | 0 | 0 |
| `src/codebuddy/tool-definitions/bug-finder-tools` | 0 | 0 | 0 |
| `src/codebuddy/tool-definitions/canvas-tools` | 0 | 0 | 0 |
| `src/codebuddy/tool-definitions/codebase-replace-tools` | 0 | 0 | 0 |
| `src/codebuddy/tool-definitions/computer-control-tools` | 0 | 0 | 0 |
| `src/codebuddy/tool-definitions/core-tools` | 0 | 0 | 0 |

## [Key Functions](./3-commands-utils.md#key-functions)


## [Cross-Subsystem Dependencies](./3-commands-utils.md#cross-subsystem-dependencies)

**Imported by:** `src/codebuddy/` (14)

## Summary

**Codebuddy** covers:
1. **Module Dependencies**
2. **Modules**
3. **Key Functions**
4. **Cross-Subsystem Dependencies**


---

**See also:** [Commands + utils](./3-commands-utils.md)


**Referenced by:** [Key Concepts](./1-2-key-concepts.md) · [Testing](./27-testing.md)



---

# Commands

<details>
<summary>Relevant source files</summary>

- `src/commands/handlers/branch-handlers.ts`
- `src/voice/speech-recognition.ts`
- `src/utils/telemetry-config.ts`
- `src/tools/codebase-replace-tool.ts`
- `src/intelligence/proactive-suggestions.ts`
- `src/personas/persona-manager.ts`
- `src/testing/coverage-targets.ts`
- `src/voice/voice-to-code.ts`

</details>

24 [modules](./3-commands-utils.md#modules) in the commands subsystem

## [Module Dependencies](./3-commands-utils.md#module-dependencies)

```mermaid
graph TD
  "branch-handlers"
  "telemetry-config"
  "codebase-replace-tool"
  "speech-recognition"
```

## Modules

| Module | Functions | Classes | Imported By |
|--------|-----------|---------|-------------|
| `src/commands/handlers/branch-handlers` | 0 | 0 | 27 |
| `src/voice/speech-recognition` | 0 | 0 | 1 |
| `src/utils/telemetry-config` | 0 | 0 | 2 |
| `src/tools/codebase-replace-tool` | 0 | 0 | 2 |
| `src/intelligence/proactive-suggestions` | 0 | 0 | 1 |
| `src/personas/persona-manager` | 0 | 0 | 1 |
| `src/testing/coverage-targets` | 0 | 0 | 1 |
| `src/voice/voice-to-code` | 0 | 0 | 1 |
| `src/observability/tracing` | 0 | 0 | 1 |
| `src/commands/handlers/bug-handler` | 0 | 0 | 0 |

## [Key Functions](./3-commands-utils.md#key-functions)


## [Cross-Subsystem Dependencies](./3-commands-utils.md#cross-subsystem-dependencies)

**Imported by:** `src/commands/` (32), `src/observability/` (2), `src/tools/` (1)
**Depends on:** `src/utils/` (3), `src/agent/` (1), `src/persistence/` (1), `src/voice/` (1), `src/tools/` (1)

## Summary

**Commands** covers:
1. **Module Dependencies**
2. **Modules**
3. **Key Functions**
4. **Cross-Subsystem Dependencies**


---

**See also:** [Commands + utils](./3-commands-utils.md)


**Referenced by:** [API Reference](./26-api-reference.md) · [Testing](./27-testing.md)



---

# Tools (Unified-vfs-router)

<details>
<summary>Relevant source files</summary>

- `src/services/vfs/unified-vfs-router.ts`
- `src/workspace/workspace-isolation.ts`
- `src/tools/intelligence/ast-parser.ts`
- `src/tools/intelligence/dependency-analyzer.ts`
- `src/tools/intelligence/symbol-search.ts`
- `src/services/vfs/memory-vfs-provider.ts`
- `src/sync/index.ts`
- `src/tools/batch-processor.ts`

</details>

22 [modules](./3-commands-utils.md#modules) in the tools subsystem

## [Module Dependencies](./3-commands-utils.md#module-dependencies)

```mermaid
graph TD
  "unified-vfs-router" --> "workspace-isolation"
  "ast-parser" --> "unified-vfs-router"
  "dependency-analyzer" --> "unified-vfs-router"
  "dependency-analyzer" --> "ast-parser"
  "symbol-search" --> "unified-vfs-router"
  "symbol-search" --> "ast-parser"
  "memory-vfs-provider" --> "unified-vfs-router"
```

## Modules

| Module | Functions | Classes | Imported By |
|--------|-----------|---------|-------------|
| `src/services/vfs/unified-vfs-router` | 0 | 0 | 45 |
| `src/workspace/workspace-isolation` | 0 | 0 | 1 |
| `src/tools/intelligence/ast-parser` | 0 | 0 | 4 |
| `src/tools/intelligence/dependency-analyzer` | 0 | 0 | 2 |
| `src/tools/intelligence/symbol-search` | 0 | 0 | 2 |
| `src/services/vfs/memory-vfs-provider` | 0 | 0 | 0 |
| `src/sync/index` | 0 | 0 | 0 |
| `src/tools/batch-processor` | 0 | 0 | 0 |
| `src/tools/changelog-generator` | 0 | 0 | 0 |
| `src/tools/code-formatter` | 0 | 0 | 0 |

## [Key Functions](./3-commands-utils.md#key-functions)


## [Cross-Subsystem Dependencies](./3-commands-utils.md#cross-subsystem-dependencies)

**Imported by:** `src/tools/` (42), `src/context/` (1)
**Depends on:** `src/utils/` (3), `src/optimization/` (1), `src/types/` (1)

## Summary

**Tools (Unified-vfs-router)** covers:
1. **Module Dependencies**
2. **Modules**
3. **Key Functions**
4. **Cross-Subsystem Dependencies**


---

**See also:** [Commands + utils](./3-commands-utils.md)



---

# Agent

<details>
<summary>Relevant source files</summary>

- `src/agent/repo-profiling/types.ts`
- `src/agent/repo-profiling/fs-helpers.ts`
- `src/agent/repo-profiling/languages/language-profiler.ts`
- `src/agent/repo-profiling/repo-profiler.ts`
- `src/agent/repo-profiling/infrastructure/directory-profiler.ts`
- `src/agent/repo-profiling/cache.ts`
- `src/agent/repo-profiling/context-pack.ts`
- `src/agent/repo-profiling/infrastructure.ts`

</details>

21 [modules](./3-commands-utils.md#modules) in the agent subsystem

## [Module Dependencies](./3-commands-utils.md#module-dependencies)

```mermaid
graph TD
  "language-profiler" --> "types"
  "language-profiler" --> "fs-helpers"
  "repo-profiler" --> "types"
  "repo-profiler" --> "fs-helpers"
  "repo-profiler" --> "cache"
  "repo-profiler" --> "context-pack"
  "repo-profiler" --> "languages"
  "repo-profiler" --> "infrastructure"
  "directory-profiler" --> "types"
  "directory-profiler" --> "fs-helpers"
  "cache" --> "types"
```

## Modules

| Module | Functions | Classes | Imported By |
|--------|-----------|---------|-------------|
| `src/agent/repo-profiling/types` | 0 | 0 | 15 |
| `src/agent/repo-profiling/fs-helpers` | 0 | 0 | 13 |
| `src/agent/repo-profiling/languages/language-profiler` | 0 | 0 | 9 |
| `src/agent/repo-profiling/repo-profiler` | 0 | 0 | 1 |
| `src/agent/repo-profiling/infrastructure/directory-profiler` | 0 | 0 | 1 |
| `src/agent/repo-profiling/cache` | 0 | 0 | 1 |
| `src/agent/repo-profiling/context-pack` | 0 | 0 | 1 |
| `src/agent/repo-profiling/infrastructure` | 0 | 0 | 1 |
| `src/agent/repo-profiling/languages` | 0 | 0 | 1 |
| `src/agent/repo-profiling/languages/dotnet-profiler` | 0 | 0 | 1 |

## [Key Functions](./3-commands-utils.md#key-functions)


## [Cross-Subsystem Dependencies](./3-commands-utils.md#cross-subsystem-dependencies)

**Imported by:** `src/agent/` (29)
**Depends on:** `src/utils/` (1)

## Summary

**Agent** covers:
1. **Module Dependencies**
2. **Modules**
3. **Key Functions**
4. **Cross-Subsystem Dependencies**


---

**See also:** [Commands + utils](./3-commands-utils.md)


**Referenced by:** [Overview](./1-overview.md) · [Key Concepts](./1-2-key-concepts.md) · [Testing](./27-testing.md)



---

# Database + analytics

<details>
<summary>Relevant source files</summary>

- `src/database/schema.ts`
- `src/database/database-manager.ts`
- `src/database/repositories/analytics-repository.ts`
- `src/events.ts`
- `src/database/repositories/session-repository.ts`
- `src/database/repositories/memory-repository.ts`
- `src/database/repositories/cache-repository.ts`
- `src/analytics.ts`

</details>

18 [modules](./3-commands-utils.md#modules) in the database + analytics subsystem

## [Module Dependencies](./3-commands-utils.md#module-dependencies)

```mermaid
graph TD
  "database-manager" --> "schema"
  "database-manager" --> "events"
  "session-repository" --> "schema"
  "session-repository" --> "database-manager"
  "analytics-repository" --> "schema"
  "analytics-repository" --> "database-manager"
  "memory-repository" --> "schema"
  "memory-repository" --> "database-manager"
```

## Modules

| Module | Functions | Classes | Imported By |
|--------|-----------|---------|-------------|
| `src/database/schema` | 0 | 0 | 12 |
| `src/database/database-manager` | 0 | 0 | 11 |
| `src/database/repositories/analytics-repository` | 0 | 0 | 4 |
| `src/events` | 0 | 0 | 2 |
| `src/database/repositories/session-repository` | 0 | 0 | 5 |
| `src/database/repositories/memory-repository` | 0 | 0 | 4 |
| `src/database/repositories/cache-repository` | 0 | 0 | 2 |
| `src/analytics` | 0 | 0 | 1 |
| `src/database/migration` | 0 | 0 | 1 |
| `src/database/repositories/embedding-repository` | 0 | 0 | 1 |

## [Key Functions](./3-commands-utils.md#key-functions)


## [Cross-Subsystem Dependencies](./3-commands-utils.md#cross-subsystem-dependencies)

**Imported by:** `src/database/` (9), `src/learning/` (3), `src/memory/` (3), `src/utils/` (3), `src/analytics/` (2), `src/persistence/` (2), `src/server/` (1), `src/undo/` (1)
**Depends on:** `src/utils/` (2)

## Summary

**Database + analytics** covers:
1. **Module Dependencies**
2. **Modules**
3. **Key Functions**
4. **Cross-Subsystem Dependencies**


---

**See also:** [Commands + utils](./3-commands-utils.md)



---

# Agent + persistence

<details>
<summary>Relevant source files</summary>

- `src/agent/types.ts`
- `src/agent/profiles.ts`
- `src/persistence/session-store.ts`
- `src/agent/operating-modes.ts`
- `src/persistence/session-lock.ts`
- `src/context/context-files.ts`
- `src/agent/profiles/types.ts`
- `src/agent/agent-mode.ts`

</details>

17 [modules](./3-commands-utils.md#modules) in the agent + persistence subsystem

## [Module Dependencies](./3-commands-utils.md#module-dependencies)

```mermaid
graph TD
  "session-store" --> "types"
  "session-store" --> "session-lock"
  "operating-modes" --> "profiles"
  "agent-mode" --> "operating-modes"
```

## Modules

| Module | Functions | Classes | Imported By |
|--------|-----------|---------|-------------|
| `src/agent/types` | 0 | 0 | 10 |
| `src/agent/profiles` | 0 | 0 | 1 |
| `src/persistence/session-store` | 0 | 0 | 9 |
| `src/agent/operating-modes` | 0 | 0 | 3 |
| `src/persistence/session-lock` | 0 | 0 | 1 |
| `src/context/context-files` | 0 | 0 | 1 |
| `src/agent/profiles/types` | 0 | 0 | 1 |
| `src/agent/agent-mode` | 0 | 0 | 3 |
| `src/security/session-encryption` | 0 | 0 | 1 |
| `src/mcp/mcp-resources` | 0 | 0 | 1 |

## [Key Functions](./3-commands-utils.md#key-functions)


## [Cross-Subsystem Dependencies](./3-commands-utils.md#cross-subsystem-dependencies)

**Imported by:** `src/agent/` (17), `src/mcp/` (3), `src/types/` (1), `src/cli/` (1), `src/infrastructure/` (1), `src/server/` (1)
**Depends on:** `src/database/` (2), `src/codebuddy/` (1), `src/types/` (1), `src/utils/` (1)

## Summary

**Agent + persistence** covers:
1. **Module Dependencies**
2. **Modules**
3. **Key Functions**
4. **Cross-Subsystem Dependencies**


---

**See also:** [Commands + utils](./3-commands-utils.md)



---

# Agent + utils (Todo-tracker)

<details>
<summary>Relevant source files</summary>

- `src/agent/todo-tracker.ts`
- `src/utils/output-sanitizer.ts`
- `src/utils/sanitize.ts`
- `src/agent/execution/agent-executor.ts`
- `src/context/restorable-compression.ts`
- `src/agent/execution/query-classifier.ts`
- `src/agent/middleware.ts`
- `src/agent/response-constraint.ts`

</details>

15 [modules](./3-commands-utils.md#modules) in the agent + utils subsystem

## [Module Dependencies](./3-commands-utils.md#module-dependencies)

```mermaid
graph TD
 "sanitize" --> "output-sanitizer"
 "agent-executor" --> "sanitize"
 "agent-executor" --> "output-sanitizer"
 "agent-executor" --> "middleware"
 "agent-executor" --> "todo-tracker"
 "agent-executor" --> "observation-variator"
 "agent-executor" --> "restorable-compression"
 "agent-executor" --> "response-constraint"
 "agent-executor" --> "proactive-compaction"
 "agent-executor" --> "query-classifier"
```

## Modules

| Module | Functions | Classes | Imported By |
|--------|-----------|---------|-------------|
| `src/agent/todo-tracker` | 0 | 0 | 3 |
| `src/utils/output-sanitizer` | 0 | 0 | 2 |
| `src/utils/sanitize` | 0 | 0 | 3 |
| `src/agent/execution/agent-executor` | 0 | 0 | 1 |
| `src/context/restorable-compression` | 0 | 0 | 2 |
| `src/agent/execution/query-classifier` | 0 | 0 | 1 |
| `src/agent/middleware` | 0 | 0 | 1 |
| `src/agent/response-constraint` | 0 | 0 | 1 |
| `src/context/observation-variator` | 0 | 0 | 1 |
| `src/context/proactive-compaction` | 0 | 0 | 1 |

## [Key Functions](./3-commands-utils.md#key-functions)


## [Cross-Subsystem Dependencies](./3-commands-utils.md#cross-subsystem-dependencies)

**Imported by:** `src/tools/` (2), `src/agent/` (2), `src/commands/` (1), `src/streaming/` (1)
**Depends on:** `src/utils/` (7), `src/agent/` (6), `src/context/` (3), `src/codebuddy/` (1), `src/errors/` (1), `src/concurrency/` (1), `src/memory/` (1)

## Summary

**Agent + utils (Todo-tracker)** covers:...
1. **Module Dependencies**
2. **Modules**
3. **Key Functions**
4. **Cross-Subsystem Dependencies**


---

**See also:** [Commands + utils](./3-commands-utils.md)



---

# Plugins

<details>
<summary>Relevant source files</summary>

- `src/plugins/types.ts`
- `src/plugins/bundled/azure-provider.ts`
- `src/plugins/bundled/bedrock-provider.ts`
- `src/plugins/bundled/copilot-provider.ts`
- `src/plugins/bundled/fireworks-provider.ts`
- `src/plugins/bundled/groq-provider.ts`
- `src/plugins/bundled/ollama-provider.ts`
- `src/plugins/bundled/openrouter-provider.ts`

</details>

13 [modules](./3-commands-utils.md#modules) in the plugins subsystem

## [Module Dependencies](./3-commands-utils.md#module-dependencies)

```mermaid
graph TD
  "azure-provider" --> "types"
  "bedrock-provider" --> "types"
  "copilot-provider" --> "types"
  "fireworks-provider" --> "types"
  "groq-provider" --> "types"
```

## Modules

| Module | Functions | Classes | Imported By |
|--------|-----------|---------|-------------|
| `src/plugins/types` | 0 | 0 | 15 |
| `src/plugins/bundled/azure-provider` | 0 | 0 | 1 |
| `src/plugins/bundled/bedrock-provider` | 0 | 0 | 1 |
| `src/plugins/bundled/copilot-provider` | 0 | 0 | 1 |
| `src/plugins/bundled/fireworks-provider` | 0 | 0 | 1 |
| `src/plugins/bundled/groq-provider` | 0 | 0 | 1 |
| `src/plugins/bundled/ollama-provider` | 0 | 0 | 1 |
| `src/plugins/bundled/openrouter-provider` | 0 | 0 | 1 |
| `src/plugins/bundled/together-provider` | 0 | 0 | 1 |
| `src/plugins/bundled/vllm-provider` | 0 | 0 | 1 |

## [Key Functions](./3-commands-utils.md#key-functions)


## [Cross-Subsystem Dependencies](./3-commands-utils.md#cross-subsystem-dependencies)

**Imported by:** `src/plugins/` (12), `src/plugin-sdk/` (3)
**Depends on:** `src/utils/` (10), `src/context/` (1), `src/commands/` (1), `src/providers/` (1), `src/tools/` (1)

## Summary

**Plugins** covers:
1. **Module Dependencies**
2. **Modules**
3. **Key Functions**
4. **Cross-Subsystem Dependencies**


---

**See also:** [Commands + utils](./3-commands-utils.md)


**Referenced by:** [Testing](./27-testing.md)



---

# Ui

<details>
<summary>Relevant source files</summary>

- `src/ui/context/theme-context.ts`
- `src/ui/dashboard/hooks/use-dashboard-data.ts`
- `src/ui/dashboard/components/metric-card.ts`
- `src/ui/dashboard/components/mini-chart.ts`
- `src/observability/dashboard.ts`
- `src/ui/dashboard/views/costs-view.ts`
- `src/ui/dashboard/views/latency-view.ts`
- `src/ui/dashboard/views/overview-view.ts`

</details>

12 [modules](./3-commands-utils.md#modules) in the ui subsystem

## [Module Dependencies](./3-commands-utils.md#module-dependencies)

```mermaid
graph TD
  "metric-card" --> "theme-context"
  "mini-chart" --> "theme-context"
  "costs-view" --> "theme-context"
  "costs-view" --> "use-dashboard-data"
  "costs-view" --> "metric-card"
  "costs-view" --> "mini-chart"
```

## Modules

| Module | Functions | Classes | Imported By |
|--------|-----------|---------|-------------|
| `src/ui/context/theme-context` | 0 | 0 | 18 |
| `src/ui/dashboard/hooks/use-dashboard-data` | 0 | 0 | 5 |
| `src/ui/dashboard/components/metric-card` | 0 | 0 | 4 |
| `src/ui/dashboard/components/mini-chart` | 0 | 0 | 4 |
| `src/observability/dashboard` | 0 | 0 | 1 |
| `src/ui/dashboard/views/costs-view` | 0 | 0 | 1 |
| `src/ui/dashboard/views/latency-view` | 0 | 0 | 1 |
| `src/ui/dashboard/views/overview-view` | 0 | 0 | 1 |
| `src/ui/dashboard/views/tools-view` | 0 | 0 | 1 |
| `src/ui/components/EnhancedChatInput` | 0 | 0 | 0 |

## [Key Functions](./3-commands-utils.md#key-functions)


## [Cross-Subsystem Dependencies](./3-commands-utils.md#cross-subsystem-dependencies)

**Imported by:** `src/ui/` (16)
**Depends on:** `src/themes/` (2), `src/optimization/` (1)

## Summary

**Ui** covers:
1. **Module Dependencies**
2. **Modules**
3. **Key Functions**
4. **Cross-Subsystem Dependencies**


---

**See also:** [Commands + utils](./3-commands-utils.md)


**Referenced by:** [Testing](./27-testing.md)



---

# Logger

<details>
<summary>Relevant source files</summary>

- `src/utils/logger.ts`

</details>

Core component: src/utils/logger


## Imported By

- `src/advanced/session-replay`
- `src/agent/agent-loader`
- `src/agent/architect-mode`
- `src/agent/background-tasks`
- `src/agent/base-agent`
- `src/agent/cache-trace`
- `src/agent/codebuddy-agent`
- `src/agent/context/memory-context-builder`
- `src/agent/custom/custom-agent-loader`
- `src/agent/definitions/agent-definition-loader`

## Summary

This page documents **Logger**: core component: src/utils/logger.


---

**See also:** [Architecture](./2-architecture.md)


**Referenced by:** [Key Concepts](./1-2-key-concepts.md) · [Types](./19-types.md) · [Client](./20-client.md) · [Knowledge graph](./21-knowledge-graph.md) · [Unified vfs router](./22-unified-vfs-router.md)



---

# Types

<details>
<summary>Relevant source files</summary>

- `src/types.ts`

</details>

Core component: src/types


## [Imported By](./18-logger.md#imported-by)

- `src/agent/architect-mode`
- `src/agent/base-agent`
- `src/agent/codebuddy-agent`
- `src/agent/execution/repair-coordinator`
- `src/agent/execution/tool-orchestrator`
- `src/agent/index`
- `src/agent/interfaces/agent.interface`
- `src/agent/multi-agent/base-agent`
- `src/agent/multi-agent/multi-agent-system`
- `src/agent/multi-agent/types`

## Summary

This page documents **Types**: core component: src/types.


---

**See also:** [Architecture](./2-architecture.md)


**Referenced by:** [Key Concepts](./1-2-key-concepts.md)



---

# Client

<details>
<summary>Relevant source files</summary>

- `src/codebuddy/client.ts`

</details>

Core component: src/codebuddy/client


## [Imported By](./18-logger.md#imported-by)

- `src/agent/architect-mode`
- `src/agent/base-agent`
- `src/agent/codebuddy-agent`
- `src/agent/execution/agent-executor`
- `src/agent/execution/tool-dependency-graph`
- `src/agent/execution/tool-orchestrator`
- `src/agent/execution/tool-selection-strategy`
- `src/agent/facades/agent-context-facade`
- `src/agent/facades/message-history-manager`
- `src/agent/middleware/auto-observation`

## Dependencies

- `src/utils/logger`
- `src/utils/model-utils`
- `src/config/model-tools`
- `src/utils/retry`
- `src/utils/base-url`
- `src/providers/circuit-breaker`
- `src/utils/rate-limit-display`

## Summary

**Client** covers:
1. **Imported By**
2. **Dependencies**


---

**See also:** [Architecture](./2-architecture.md)


**Referenced by:** [Overview](./1-overview.md) · [Key Concepts](./1-2-key-concepts.md) · [Commands + utils](./3-commands-utils.md) · [Knowledge graph](./21-knowledge-graph.md) · [Unified vfs router](./22-unified-vfs-router.md) · [Security](./24-security.md)



---

# Knowledge graph

<details>
<summary>Relevant source files</summary>

- `src/knowledge/knowledge-graph.ts`

</details>

Core component: src/knowledge/knowledge-graph


## [Imported By](./18-logger.md#imported-by)

- `src/agent/middleware/reasoning-middleware`
- `src/agent/middleware/workflow-guard`
- `src/agent/repair/fault-localization`
- `src/agent/repo-profiler`
- `src/agent/specialized/swe-agent`
- `src/commands/enhanced-command-handler`
- `src/commands/handlers/graph-handlers`
- `src/commands/slash/docs-command`
- `src/docs/blueprint-builder`
- `src/docs/discovery/project-discovery`

## [Dependencies](./20-client.md#dependencies)

- `src/utils/logger`
- `src/knowledge/graph-pagerank`
- `src/knowledge/graph-embeddings`

## Summary

**Knowledge graph** covers:
1. **Imported By**
2. **Dependencies**


---

**See also:** [Architecture](./2-architecture.md)



---

# Unified vfs router

<details>
<summary>Relevant source files</summary>

- `src/services/vfs/unified-vfs-router.ts`

</details>

Core component: src/services/vfs/unified-vfs-router


## [Imported By](./18-logger.md#imported-by)

- `src/services/vfs/memory-vfs-provider`
- `src/sync/index`
- `src/tools/advanced/multi-file-editor`
- `src/tools/advanced/operation-history`
- `src/tools/archive-tool`
- `src/tools/audio-tool`
- `src/tools/batch-processor`
- `src/tools/browser-tool`
- `src/tools/changelog-generator`
- `src/tools/clipboard-tool`

## [Dependencies](./20-client.md#dependencies)

- `src/optimization/latency-optimizer`
- `src/workspace/workspace-isolation`

## Summary

**Unified vfs router** covers:
1. **Imported By**
2. **Dependencies**


---

**See also:** [Architecture](./2-architecture.md)



---

# Code Quality Metrics

[Architecture](./2-architecture.md) type: **plugin-based**

## [Layers](./2-architecture.md#layers)

| Layer | Modules |
|-------|---------|
| `src/agent` | 149 |
| `src/tools` | See the tool registry; no inventory total claimed |
| `src/commands` | 90 |
| `src/utils` | 73 |
| `src/context` | 53 |
| `src/channels` | 49 |
| `src/ui` | 49 |
| `src/security` | 44 |
| `src/knowledge` | 28 |
| `src/server` | 28 |
| `src/codebuddy` | 26 |
| `src/config` | 26 |
| `src/plugins` | 23 |
| `src/hooks` | 20 |
| `src/integrations` | 20 |

## [Entry Points](./2-architecture.md#entry-points)

- `src/advanced/session-replay`
- `src/agent/agent-loader`
- `src/agent/architect-mode`
- `src/agent/background-tasks`
- `src/agent/cache-trace`

## [Layer Diagram](./2-architecture.md#layer-diagram)

```mermaid
graph TD
  "agent"["agent (149)"]
  "tools"["tool registry"]
  "commands"["commands (90)"]
  "utils"["utils (73)"]
  "context"["context (53)"]
  "channels"["channels (49)"]
  "ui"["ui (49)"]
  "security"["security (44)"]
  "agent" --> "tools"
  "tools" --> "commands"
  "commands" --> "utils"
  "utils" --> "context"
  "context" --> "channels"
  "channels" --> "ui"
  "ui" --> "security"
```

## Summary

**Code Quality Metrics** covers:
1. **Layers**
2. **Entry Points**
3. **Layer Diagram**


---

**See also:** [Architecture](./2-architecture.md)



---

# Security

<details>
<summary>Relevant source files</summary>

- `src/security.ts`

</details>

The project has **44** security [modules](./3-commands-utils.md#modules) in `src/security/`.

## Security [Dependencies](./20-client.md#dependencies)

| Package | Category |
|---------|----------|
| `cors` | HTTP Hardening |

## Security Modules

| Module | Functions | Imported By |
|--------|-----------|-------------|
| `src/security/sandbox` | 0 | 6 |
| `src/security/audit-logger` | 0 | 4 |
| `src/channels/pro/scoped-auth` | 0 | 4 |
| `src/sandbox/sandbox-backend` | 0 | 4 |
| `src/security/bash-parser` | 0 | 3 |
| `src/security/ssrf-guard` | 0 | 3 |
| `src/agent/specialized/security-review/types` | 0 | 3 |
| `src/security/security-modes` | 0 | 3 |
| `src/security/data-redaction` | 0 | 3 |
| `src/security/dangerous-patterns` | 0 | 3 |
| `src/security/tool-policy/types` | 0 | 3 |
| `src/config/secret-ref` | 0 | 2 |
| `src/security/credential-manager` | 0 | 2 |
| `src/security/dependency-vuln-scanner` | 0 | 2 |
| `src/security/shell-env-policy` | 0 | 2 |
| `src/security/write-policy` | 0 | 2 |
| `src/server/auth/api-keys` | 0 | 2 |
| `src/agent/specialized/code-guardian-agent` | 0 | 2 |
| `src/agent/specialized/security-review-agent` | 0 | 2 |
| `src/sandbox/safe-eval` | 0 | 2 |
| `src/security/bash-allowlist/types` | 0 | 2 |
| `src/security/bash-allowlist/pattern-matcher` | 0 | 2 |
| `src/security/tool-policy/tool-groups` | 0 | 2 |
| `src/security/tool-policy/profiles` | 0 | 2 |
| `src/server/auth/jwt` | 0 | 2 |

## Summary

**Security** covers:
1. **Security Dependencies**
2. **Security Modules**


---

**See also:** [Overview](./1-overview.md)


**Referenced by:** [Testing](./27-testing.md)



---

# Configuration

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GROK_API_KEY` |  |

## Summary

This page documents **Configuration**: environment variables and settings.


---

**See also:** [Getting Started](./1-1-getting-started.md)


**Referenced by:** [Testing](./27-testing.md)



---

# API Reference

## CLI [Commands](./10-commands.md)

| Command | Description |
|---------|-------------|
| `git` | — |
| `commit-and-push` | — |
| `channels` | — |
| `server` | — |
| `mcp-server` | — |
| `backup [subcommand] [args...]` | — |
| `cloud [subcommand] [args...]` | — |

## HTTP API

| Method | Path |
|--------|------|
| `GET` | `/.well-known/agent.json` |
| `GET` | `/agents` |
| `POST` | `/tasks/send` |
| `GET` | `/tasks/:id` |
| `POST` | `/tasks/:id/cancel` |
| `GET` | `/agents/by-skill/:skillId` |
| `POST` | `/send` |
| `GET` | `/agents` |
| `POST` | `/request` |
| `GET` | `/tasks/:id` |
| `POST` | `/tasks/:id/yield` |
| `POST` | `/tasks/:id/resume` |
| `POST` | `/sessions` |
| `GET` | `/sessions` |
| `GET` | `/sessions/:name` |
| `DELETE` | `/sessions/:name` |
| `POST` | `/sessions/:name/cancel` |
| `POST` | `/sessions/:name/close` |
| `POST` | `/` |
| `POST` | `/completions` |
| `GET` | `/models` |
| `POST` | `/` |
| `GET` | `/` |
| `GET` | `/:id` |
| `GET` | `/:id/stream` |
| `POST` | `/:id/cancel` |
| `DELETE` | `/:id` |
| `GET` | `/:id/logs` |
| `GET` | `/` |
| `GET` | `/*` |
| `GET` | `/` |
| `GET` | `/ready` |
| `GET` | `/live` |
| `GET` | `/stats` |
| `GET` | `/metrics` |
| `GET` | `/version` |
| `GET` | `/config` |
| `POST` | `/gc` |
| `GET` | `/dependencies` |
| `GET` | `/healthz` |
| `GET` | `/readyz` |
| `GET` | `/livez` |
| `GET` | `/` |
| `POST` | `/` |
| `GET` | `/search` |
| `GET` | `/stats` |
| `POST` | `/clear` |
| `GET` | `/context` |
| `POST` | `/context/compress` |
| `POST` | `/import` |


## Summary

**API Reference** covers:
1. **CLI Commands**
2. **HTTP API**


---

**See also:** [Overview](./1-overview.md)



---

# Testing

**Framework:** vitest

**Total test files:** 710

## Test Organization

| Type | Files |
|------|-------|
| other | 62 |
| acp | 1 |
| [agent](./12-agent.md) | 29 |
| agents | 1 |
| analytics | 2 |
| auth | 1 |
| browser-automation | 5 |
| canvas | 2 |
| [channels](./8-channels.md) | 24 |
| cli | 1 |
| cloud | 1 |
| [codebuddy](./9-codebuddy.md) | 1 |
| [commands](./10-commands.md) | 15 |
| concurrency | 2 |
| [config](./25-configuration.md) | 9 |
| context | 12 |
| copilot | 1 |
| daemon | 4 |
| desktop-automation | 4 |
| docs | 1 |
| doctor | 1 |
| elevated-mode | 1 |
| email | 1 |
| events | 1 |
| extensions | 1 |
| fcs | 2 |
| features | 15 |
| fuzz | 1 |
| gateway | 3 |
| hooks | 4 |
| identity | 1 |
| input | 1 |
| integration | 7 |
| integrations | 5 |
| interpreter | 1 |
| load | 1 |
| location | 1 |
| lsp | 1 |
| mcp | 3 |
| media | 1 |
| memory | 3 |
| observability | 1 |
| observer | 2 |
| optimization | 1 |
| orchestration | 1 |
| persistence | 2 |
| planner | 2 |
| [plugins](./16-plugins.md) | 6 |
| presence | 1 |
| proactive | 2 |
| prompts | 1 |
| protocols | 1 |
| providers | 2 |
| reasoning | 3 |
| sandbox | 7 |
| scheduler | 1 |
| screen-capture | 1 |
| search | 2 |
| [security](./24-security.md) | 11 |
| server | 9 |
| session-pruning | 1 |
| sidecar | 1 |
| skills | 12 |
| skills-registry | 1 |
| streaming | 5 |
| sync | 1 |
| talk-mode | 2 |
| tasks | 1 |
| testing | 3 |
| themes | 1 |
| [tools](./5-tools.md) | 18 |
| tracks | 1 |
| triggers | 1 |
| [ui](./17-ui.md) | 9 |
| unit | 341 |
| utils | 14 |
| voice | 2 |
| webhooks | 1 |
| wizard | 1 |
| workflows | 3 |
| _archived | 2 |

## Running Tests

```bash
npm run test  # vitest run
npm run test:watch  # vitest
npm run test:coverage  # vitest run --coverage
```

## Summary

**Testing** covers:
1. **Test Organization**
2. **Running Tests**


---

**See also:** [Getting Started](./1-1-getting-started.md)



---

# Troubleshooting

## Common Issues

| Symptom | Cause | Solution |
|---------|-------|----------|
| Module not found | Missing build step | Run `npm run build` |
| API key error | Missing env var | Set required API key in `.env` |
| Tests fail | Outdated deps | Run `npm install` |
| `GROK_API_KEY` not set | Missing environment variable | `export GROK_API_KEY=...` |

## Debug Mode

Run in development mode: `npm run dev`

Run tests: `npm test`

Check code quality: `npm run lint`


## Summary

**Troubleshooting** covers:
1. **Common Issues**
2. **Debug Mode**


---

**See also:** [Getting Started](./1-1-getting-started.md)



---

