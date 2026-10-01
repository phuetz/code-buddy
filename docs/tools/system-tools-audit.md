# System Tools Audit & `fleetSafe` Wiring

<!-- showcase:historical -->
**Historical record — outside the current evidence catalogue, not revalidated here.** Counts and validation labels below describe the dated snapshot, not this candidate. For current statuses and reasons, see the root feature catalogue.

**Date:** 2026-05-07
**Scope:** Code Buddy tool architecture review + first-pass fleet-safety
flag (binding multi-AI gaps closed by [`913d1f6`](#commit-913d1f6) toward
A2A peer-invocation safety).
**Status:** Phase 1 complete (audit + binary `fleetSafe` flag wired). Phases
2-3 (broader policy, registry consolidation) deferred — see
[Why we did NOT follow the 3-day plan as written](#why-we-did-not-follow-the-3-day-plan-as-written).

## TL;DR

- **Diagnostic from the Grok-authored audit** (3 registries, ~85-90 tools,
  no fleet-safety boundary) is **factually correct**.
- **Prescription from that same audit** (4 sub-categories, fuse the 3
  registries, fork `bash` into `safe_bash`) **rebuilds anti-patterns it
  criticized** — over-engineering on top of solved primitives, and breaks
  an explicit prior architecture decision (audit #27).
- **What was actually shipped tonight:** a single binary `fleetSafe?: boolean`
  flag on `ToolMetadata` + `IToolMetadata`, populated for ~22 obviously
  read-only tools, plus `isFleetSafe()` / `getFleetSafeTools()` helpers on
  the legacy `ToolRegistry`. No new tool, no policy class, no registry fusion.
- **What is NOT yet wired:** the actual filtering call in the A2A executor
  / fleet event bus. The flag is queryable; nothing reads it yet. That step
  is the smaller half of the work and the right target for the next session.

## Architecture findings

### The "3 registries" are layered, not duplicated

| Registry | Purpose | File | Consumed by |
|---|---|---|---|
| `ToolRegistry` (legacy) | LLM function-calling schemas + RAG selection | `src/tools/registry.ts` | `getAllCodeBuddyTools()`, `ToolSelector`, `/api/tools` |
| `FormalToolRegistry` | Executable `ITool` instances + event emission | `src/tools/registry/tool-registry.ts` | `agent/tool-handler.ts` (execution path) |
| `ToolManager` | Permissions (`always`/`ask`/`never`) + lazy load + TOML | `src/tools/tool-manager.ts` | TOML config + confirmation gates |

`registry.ts` line 8 (verbatim) calls out **audit #27**: this split is an
explicit, prior decision — schemas / execution / permissions are different
concerns. The Grok plan's "fuse the registries" ticket would re-merge what
audit #27 separated on purpose. **No fusion this session.**

If a future audit revisits #27, the discriminating question is: does any
single consumer need *all three* views simultaneously, or do they each pull
from one layer? Right now the answer is the latter.

### What was actually missing

There was **no boundary between local-user-invoked tools and peer-invoked
(A2A / fleet) tools**. `agent-executor.ts` and the A2A `TaskExecutor` see
the same tool list. With cross-host A2A live (closed in [`913d1f6`](#commit-913d1f6)),
that's a real capability/security gap — a peer can request `bash`,
`computer_control`, or `kubernetes` and the local Code Buddy will run them
without the local user being there to approve.

The fix is one boolean: **can a peer invoke this tool unsupervised?**

## The `fleetSafe` flag

### Type definitions

```ts
// src/tools/types.ts (legacy registry)
export interface ToolMetadata {
  name: string;
  category: ToolCategory;
  keywords: string[];
  priority: number;
  description: string;
  fleetSafe?: boolean;        // ← new, default false (opt-in)
}

// src/tools/registry/types.ts (formal registry — kept in lockstep)
export interface IToolMetadata {
  // … existing flags: requiresConfirmation, modifiesFiles, makesNetworkRequests
  fleetSafe?: boolean;
}
```

### Binding criteria (a tool gets `fleetSafe: true` iff ALL hold)

1. Read-only **or** strictly bounded side effects — no arbitrary code
   execution, no host-side mutation the local user hasn't authorized
2. Cannot exfiltrate secrets (`env`, `~/.ssh`, `~/.aws`, credential
   stores)
3. Cannot drive UI input (keyboard / mouse synthesis)
4. Bounded resource usage (no unbounded loops, sub-process forks, etc.)

### First-pass population (~22 tools marked `fleetSafe: true`)

| Tool | Why safe |
|---|---|
| `view_file`, `list_directory` | Pure filesystem reads (subject to path policy already in place) |
| `search`, `find_symbols`, `find_references`, `find_definition`, `search_multi` | Read-only code search |
| `web_search`, `web_fetch`, `firecrawl_search`, `firecrawl_scrape` | Outbound HTTP only — already public surface |
| `get_todo_list` | Read-only state |
| `codebase_map`, `code_graph`, `knowledge_graph` | Pure graph queries |
| `reason` | LLM thinking, no host effect |
| `docs_search` | Read-only docs query |
| `restore_context`, `knowledge_search`, `recall`, `lessons_search`, `lessons_list` | Read-only memory |
| `find_bugs` | Static analysis (regex) |
| `terminate` | Control-flow sentinel |
| `sessions_list`, `sessions_history` | Read-only multi-agent introspection |

### Tools deliberately left `fleetSafe = undefined` (i.e. `false`)

- **System / exec:** `bash`, `process`, `js_repl`, `docker`, `kubernetes`,
  `run_script`, `computer_control` (the audit's #1 risk class — safe to
  block at the peer boundary)
- **File mutation:** `create_file`, `str_replace_editor`, `edit_file`,
  `multi_edit`, `codebase_replace`
- **State mutation:** `create_todo_list`, `update_todo_list`,
  `knowledge_add`, `lessons_add`, `remember`, `forget`
- **Multi-agent control:** `spawn_subagent`, `spawn_parallel_agents`,
  `sessions_send`, `sessions_spawn` — peer should not be able to spawn
  more agents on our host
- **Repo mutation:** `git`, `auto_commit`, `resolve_conflicts`
- **Refactoring:** `lsp_rename`, `lsp_code_action`
- **Sensitive read:** `scan_secrets`, `scan_vulnerabilities` — read-only
  but expose secret material; default-deny is the safer call
- **UI / device:** `browser`, `audio`, `video`, `clipboard`, `screenshot`,
  `device_manage`
- **Local UX flow:** `ask_human`, `ask_user_question`, `exit_plan_mode`,
  `advisor` — these talk to the local user, not a peer
- **Output writers:** `diagram`, `export`, `qr`, `a2ui`, `canvas`,
  `deploy`, `task_verify`, `create_skill`, `skill_discover`

### Helpers (legacy registry)

```ts
// src/tools/registry.ts
public isFleetSafe(name: string): boolean;
public getFleetSafeTools(): CodeBuddyTool[];
```

Defaults to `false` if the metadata flag is absent — behaves as if the
tool were locally-restricted, which is the safe default.

## What's NOT wired (next-session targets)

1. ~~**A2A inbound tool filtering.**~~ ✅ **Done.** `createCodeBuddyTaskExecutor()`
   in `src/protocols/a2a/codebuddy-executor.ts` now calls
   `getFleetSafeTools()` and exposes only opted-in tools to the
   peer-driven LLM. Wired into `src/server/routes/a2a-protocol.ts` on
   route boot, with rate-limit (10 req/min) and audit log
   `[a2a:inbound]`. AgentCard rectified to declare honest skills
   (`code-search`, `code-read`, `codebase-analysis`, `web-query`,
   `reasoning`) instead of misleading `code-edit` / `code-debug`. 8 unit
   tests cover happy path, tool dispatch, hallucinated-tool defense,
   turn cap, cost cap, fail-closed (no key / no tools), audit log
   PII-safety.

2. **Fleet event bus filtering.** Out of scope here — events are *emitted*,
   not *invoked*. Today's broadcast already lacks tool-execution. If
   peer-RPC (Phase d.13) is enabled, that path needs the same flag check.

3. **Settings UI for the flag.** A "fleet-safe tools" page in Cowork
   settings could let the user audit which tools would be exposed to a
   peer before they ever connect one. Cosmetic, not blocking.

4. **Tests for the flag.** A unit test on the legacy `ToolRegistry`
   would exercise `isFleetSafe()` / `getFleetSafeTools()`. The
   pre-existing `bash-tool.test.ts` failures (5 fails on env-vars +
   streaming) are unrelated and predate this change — verified by
   stash-and-rerun.

## Why we did NOT follow the 3-day plan as written

The plan posted in chat (T1-T15 over 3 days) was generated by another AI
based on its own reading of the audit. After verifying its claims against
the code, three of its core tickets are **wrong moves**:

| Ticket | Plan said | Why we didn't do it |
|---|---|---|
| T1 — `SystemToolPolicy.ts` with 4 sub-categories (`safe`/`controlled`/`dangerous`/`utility`) | Build a 4-axis taxonomy | The actual question is **binary** (peer-invokable yes/no). Adding a 4th axis on top of existing `permission` (3 levels), `ToolProfile` (4 profiles), and `IToolMetadata` flags is category sprawl. The next reader reinvents the binary anyway. |
| T6 — Fuse the 3 registries into one `FormalToolRegistry` | Remove duplication | Not duplication. Layered architecture, decided by audit #27 (cited in `registry.ts` line 8). Fusion would break the LLM-schema / execution / permission separation on purpose. |
| T3 — Refactor `bash` → `safe_bash` + preview (4h) | Build a parallel safe variant | `bash` already has `SandboxManager` + `command-validator` + `SafeBinariesChecker` + protected-paths + audit-logger — the **most-guarded** tool in the codebase. Forking it duplicates exactly what the audit said to remove. The peer-invocation concern is solved by `fleetSafe: false` on the existing tool — no new tool needed. |

The plan's diagnosis was sound. Its prescription wasn't. The cheaper move
that closes the same gap is the binary flag shipped here.

## Next-session backlog

Ordered by impact / effort:

1. **A2A `TaskExecutor` filters by `getFleetSafeTools()`** — ~1h, makes
   the flag actually enforce something
2. **Tests** — unit tests for `isFleetSafe`, `getFleetSafeTools`,
   integration test that a peer-invoked task with a non-fleet-safe tool
   gets rejected — ~1.5h
3. **Documentation** — surface the flag in `docs/tools/TOOLS.md` (auto-gen
   if `tools-md-generator.ts` supports it; verify before assuming)
4. **Audit pass on borderline tools** — `scan_secrets` and `screenshot`
   are debatable; revisit with a real threat-model conversation
5. **Cowork settings UI** — visualize fleet-exposed tool list before peer
   connect

## Commit reference

- <a id="commit-913d1f6"></a>**`913d1f6`** — `feat(cowork): fleet listener
  + A2A task polling (multi-AI gaps 1+3)` — established the cross-host
  observability that makes the fleet-safety question concrete
- This document + flag — to be committed after review
