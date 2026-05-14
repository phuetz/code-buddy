# Agents and Orchestration

## Multi-Agent Orchestration (5-Tool API)

Code Buddy provides 5 LLM-callable tools for agent orchestration:

| Tool | Purpose |
|:-----|:--------|
| `spawn_agent` | Create sub-agent with role, depth limit (max 3), nickname |
| `send_input` | Send message to agent (with optional interrupt) |
| `wait_agent` | Wait for agents to complete (with timeout) |
| `close_agent` | Shutdown agent, release slot |
| `resume_agent` | Resurrect closed agent |

- Max 10 concurrent agents
- Completion watchers auto-notify parents
- Nickname pool (24 names) with generation suffixes
- `yield: true` on `spawn_agent` suspends the parent until the sub-agent completes (`YIELD_SIGNAL`)
- `memory` option enables persistent agent memory across sessions

## Agent Roles

Three built-in roles control what tools an agent can access:

| Role | Access | Spawning |
|:-----|:-------|:---------|
| **explorer** | Read-only (search/read tools only), fast codebase Q&A | No |
| **worker** | All tools except spawn, file ownership | Sequential |
| **default** | Full capabilities | Yes |

Custom roles can be defined in `.codebuddy/roles/<name>.json`. Roles are checked via `isToolAllowedForRole()`.

TOML config layering is supported for role configuration.

## Specialized Agents (8 Built-in)

| Agent | Purpose |
|:------|:--------|
| **PDF** | PDF document processing |
| **Excel** | Spreadsheet analysis |
| **DataAnalysis** | Statistical and data processing |
| **SQL** | Schema analysis, query optimization |
| **Archive** | ZIP/TAR archive extraction and analysis |
| **Code Guardian** | Architecture review, refactoring suggestions, patch planning |
| **Security Review** | Vulnerability detection, compliance checks |
| **SWE** | OpenManus-compatible code editing/debugging with think-act loop |

Managed by `AgentRegistry` (`src/agent/specialized/agent-registry.ts`). Per-agent parameter overrides (temperature, maxTokens, model) configurable via `agent_defaults.agents.<id>` in TOML.

## SWE Agent (OpenManus)

Think-act loop with 3 tools: `bash`, `str_replace_editor`, `terminate`. Features:
- Max-step limit with stuck detection (3 duplicate actions trigger perturbation)
- Output truncation for long results
- State machine: IDLE -> RUNNING -> THINKING -> ACTING -> FINISHED/ERROR
- `__AGENT_TERMINATE__` signal for explicit loop exit

## Planning Flow

Multi-agent plan-execute-synthesize pipeline:

```
Plan -> Parallel/Sequential Execute -> Synthesize
```

- Dependency-ordered execution with retry
- `PlanStepStatus` tracking (pending/running/completed/failed)
- CLI: `buddy flow "<goal>" [--max-retries N] [--verbose]`

## Batch Decomposition

`/batch <goal>` decomposes a goal into parallel execution units via LLM:
1. LLM breaks the goal into independent sub-tasks
2. Dependency ordering determines execution order
3. Plan approval before execution
4. Agents spawned for each unit

## A2A Protocol (Google Agent-to-Agent)

Implementation of the Google A2A spec for inter-agent communication:

- **AgentCard** discovery: `GET /api/a2a/.well-known/agent.json`
- **Task lifecycle**: submit, cancel, status polling
- **Client/Server**: `A2AAgentServer` (executor callback) + `A2AAgentClient` (registry + skill discovery)
- HTTP endpoints: `POST /api/a2a/tasks/send`, `GET /api/a2a/tasks/:id`, `POST /api/a2a/tasks/:id/cancel`
- Inbound Code Buddy execution uses the same provider auto-detection as the CLI, including ChatGPT Codex OAuth via `buddy login chatgpt`.

## Agent Teams (Tmux)

Tmux session management for coordinating multiple agents:
- `InProcessTeamSession` fallback when tmux is unavailable
- `/team start|add|status|stop|task|send|inbox` slash commands

## Agent Memory

Persistent filesystem memory for sub-agents:
- Scopes: `user` (`~/.codebuddy/`), `project` (`.codebuddy/`), `local`
- Auto-loaded on spawn, auto-saved on completion

## Supervisor Agent

Coordinates multiple agent instances with:
- **Strategies**: sequential, parallel, race, all
- **Shared context**: thread-safe key-value store with optimistic locking
- **Self-healing**: error pattern recognition (6 built-in patterns), auto-recovery with exponential backoff
- **Checkpoint rollback**: auto-checkpoint before risky ops, rollback to last good state
