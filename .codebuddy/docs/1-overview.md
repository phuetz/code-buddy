# @phuetz/code-buddy v0.5.0

<details>
<summary>Relevant source files</summary>

- `src/utils/logger.ts`
- `src/types.ts`
- `src/codebuddy/client.ts`
- `src/knowledge/knowledge-graph.ts`
- `src/services/vfs/unified-vfs-router.ts`

</details>

> Open-source multi-provider AI coding [agent](./12-agent.md) for the terminal. Supports Grok, Claude, ChatGPT, Gemini, Ollama and LM Studio with 52+ [tools](./5-tools.md), multi-channel messaging, skills system, and OpenClaw-inspired [architecture](./2-architecture.md).

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
