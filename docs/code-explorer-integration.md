# Code Explorer integration (graph-powered code intelligence)

> **Optional proprietary add-on.** Code Buddy works fully without it. When present, it makes the agent understand a codebase through a **pre-indexed knowledge graph** — callers, callees, blast radius, hotspots — instead of reading files one at a time.

AI coding agents (Code Buddy included, like Cursor / Copilot / Claude Code) read files **on demand, one at a time**. On a large project that means reading dozens of files to follow a single call chain, starting from scratch every conversation, and filling the context window with raw source.

[**Code Explorer**](https://github.com/phuetz/code-explorer) (the `gitnexus` engine, written in Rust) pre-indexes your **entire** repo into a knowledge graph and exposes 30 tools over MCP (the public build; a private edition adds a `business` tool):

| | Agent alone | Agent + Code Explorer |
|---|---|---|
| **Relationships** | Read each file to discover who calls what | Pre-computed graph: instant callers, callees, hierarchy |
| **Scale** | ~50 files in context max | Whole repo indexed, queryable in one call |
| **Persistence** | Starts from scratch each chat | Graph persists on disk, always available |
| **Impact analysis** | Impossible without reading the project | `impact <symbol>` → full blast radius in ~1s |
| **Context budget** | Reading 50 files = no room to think | Returns only the relevant relationships |

Real example on Code Buddy's own source (1864 files → 63 719 nodes / 146 120 edges):

```text
$ gitnexus impact executePlan --repo src --direction downstream
Downstream (symbols affected by changes):
  Depth 1 (7 nodes): TaskPlanner, DelegationEngine, TaskGraph, ProgressTracker,
                     execute, createPlan, start
  Depth 2 (39 nodes): …
  Total affected: 82 symbols      # 187 with --direction both (82 down + 105 up)
```

## Setup (3 steps)

1. **Get Code Explorer** (`code-explorer` on your `PATH`; the older binary name `gitnexus` still works). It's a separate product — see <https://github.com/phuetz/code-explorer>.
2. **Index your repo once:**
   ```bash
   code-explorer analyze .            # ~seconds; re-run with --incremental after changes
   ```
3. **Enable the MCP server** in `.codebuddy/mcp.json` (a template already ships there). Canonical server name is `code-explorer`; `gitnexus` is still recognized:
   ```json
   {
     "mcpServers": {
       "code-explorer": { "type": "stdio", "command": "code-explorer", "args": ["mcp"], "enabled": true }
     }
   }
   ```
   Verify: `buddy mcp test code-explorer` → *Successfully connected · 30 tools*.

That's it. The bundled **`code-explorer` skill** then nudges the agent to reach for `impact` / `context` / `query` when a question is about relationships, so you don't have to ask explicitly.

> **One gotcha — selecting the repo.** Raw Code Explorer MCP tools (`mcp__code-explorer__query`, …) take a `repo` argument. The server keeps a *global* registry of every repo you've ever indexed and **fails closed** (`Multiple repos indexed (N). Specify 'repo' parameter.`) when `repo` is omitted. The native `code_explorer_ask` tool and `buddy research ingest-code` resolve that for you: they call `list_repos` and pick the graph that contains the current working directory (else the first indexed repo). If you call the MCP tools yourself, pass the project's **path or id** (not the bare `name`, which can collide).

## What the agent can do now

- *"What breaks if I change `executePlan`?"* → `impact` blast radius.
- *"Who calls `loadApiKey` and what does it call?"* → `context` 360° view.
- *"Where is rate limiting implemented?"* → `query` / `search_code`.
- *"Any circular deps / dead code / complexity hotspots?"* → `find_cycles` / `coverage` / `get_complexity`.
- *"How risky is my current diff?"* → `detect_changes`.

## Notes

- **No lock-in.** Remove the MCP entry and Code Buddy behaves exactly as before. The graph is a local snapshot you own.
- **Read-only.** Every tool is analysis-only except `rename`, which defaults to a dry run.
- **How it loads.** Interactive `buddy` loads MCP servers at session start with a per-server timeout (`CODEBUDDY_MCP_INIT_TIMEOUT_MS`, default 15s): a slow server is skipped so the others still load, then reconnects in the background. **Headless `buddy -p` defaults MCP off** for startup cost/determinism — opt in with `CODEBUDDY_DISABLE_MCP=false`. `buddy mcp test code-explorer` (which connects explicitly) is the reliable way to confirm the bridge itself is healthy.
- **Relationship to Code Buddy's built-in graph (honest framing).** Code Buddy already ships graph tools — `code_graph` / `codebase_map`, backed by an internal `KnowledgeGraph` — that also do callers/callees/impact/dead-code. So Code Explorer is **not** "a graph where there was none"; it's a **broader, multi-language (14 langs), whole-repo** graph for projects where the built-in falls short. Both are offered to the model when gitnexus is installed, and Code Buddy injects a directive (only when gitnexus is connected) steering the agent to prefer the gitnexus tools for relationship/blast-radius questions. On a spot check (`impact executePlan --direction both`) gitnexus-over-MCP returns the full **187 affected symbols** vs the built-in's **~20** — so the win is real (breadth + completeness), not just "the agent had no graph." (An earlier MCP under-report of 18 was a gitnexus bug, since fixed — the MCP path now matches the CLI.)
- The 30 public tools (a private edition adds `business`): `list_repos`, `query`, `context`, `impact`, `detect_changes`, `rename`, `cypher`, `hotspots`, `coupling`, `ownership`, `coverage`, `diagram`, `report`, `search_processes`, `analyze_execution_trace`, `search_code`, `read_file`, `get_insights`, `save_memory`, `find_cycles`, `find_similar_code`, `list_todos`, `get_complexity`, `list_endpoints`, `list_db_tables`, `list_env_vars`, `get_endpoint_handler`, `list_sfd_pages`, `write_sfd_draft`, `validate_sfd`.
