# Code Explorer integration (graph-powered code intelligence)

> **Optional proprietary add-on.** Code Buddy works fully without it. When present, it makes the agent understand a codebase through a **pre-indexed knowledge graph** — callers, callees, blast radius, hotspots — instead of reading files one at a time.

AI coding agents (Code Buddy included, like Cursor / Copilot / Claude Code) read files **on demand, one at a time**. On a large project that means reading dozens of files to follow a single call chain, starting from scratch every conversation, and filling the context window with raw source.

[**Code Explorer**](https://github.com/phuetz/code-explorer) (the `gitnexus` engine, written in Rust) pre-indexes your **entire** repo into a knowledge graph and exposes 27 tools over MCP:

| | Agent alone | Agent + Code Explorer |
|---|---|---|
| **Relationships** | Read each file to discover who calls what | Pre-computed graph: instant callers, callees, hierarchy |
| **Scale** | ~50 files in context max | Whole repo indexed, queryable in one call |
| **Persistence** | Starts from scratch each chat | Graph persists on disk, always available |
| **Impact analysis** | Impossible without reading the project | `impact <symbol>` → full blast radius in ~1s |
| **Context budget** | Reading 50 files = no room to think | Returns only the relevant relationships |

Real example on Code Buddy's own source (1864 files → 38 090 nodes / 93 603 edges, indexed in ~12 s):

```text
$ gitnexus impact executePlan
Downstream (symbols affected by changes):
  Depth 1 (6 nodes): processUserMessage, DelegationEngine, TaskGraph,
                     ProgressTracker, TaskPlanner, map
  Depth 2 (45 nodes): …
```

## Setup (3 steps)

1. **Get Code Explorer** (`gitnexus` on your `PATH`). It's a separate product — see <https://github.com/phuetz/code-explorer>.
2. **Index your repo once:**
   ```bash
   gitnexus analyze .            # ~seconds; re-run with --incremental after changes
   ```
3. **Enable the MCP server** in `.codebuddy/mcp.json` (a disabled template already ships there — flip `enabled` to `true`):
   ```json
   {
     "mcpServers": {
       "gitnexus": { "type": "stdio", "command": "gitnexus", "args": ["mcp"], "enabled": true }
     }
   }
   ```
   Verify: `buddy mcp test gitnexus` → *Successfully connected · 27 tools*.

That's it. The bundled **`code-explorer` skill** then nudges the agent to reach for `impact` / `context` / `query` when a question is about relationships, so you don't have to ask explicitly.

## What the agent can do now

- *"What breaks if I change `executePlan`?"* → `impact` blast radius.
- *"Who calls `loadApiKey` and what does it call?"* → `context` 360° view.
- *"Where is rate limiting implemented?"* → `query` / `search_code`.
- *"Any circular deps / dead code / complexity hotspots?"* → `find_cycles` / `coverage` / `get_complexity`.
- *"How risky is my current diff?"* → `detect_changes`.

## Notes

- **No lock-in.** Remove the MCP entry and Code Buddy behaves exactly as before. The graph is a local snapshot you own.
- **Read-only.** Every tool is analysis-only except `rename`, which defaults to a dry run.
- The 27 tools: `list_repos`, `query`, `context`, `impact`, `detect_changes`, `rename`, `cypher`, `hotspots`, `coupling`, `ownership`, `coverage`, `diagram`, `report`, `business`, `analyze_execution_trace`, `search_code`, `read_file`, `get_insights`, `save_memory`, `find_cycles`, `find_similar_code`, `list_todos`, `get_complexity`, `list_endpoints`, `list_db_tables`, `list_env_vars`, `get_endpoint_handler`.
