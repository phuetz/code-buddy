# Tools

Code Buddy includes ~110 tools organized into categories. Tools are selected per query via RAG embedding to minimize prompt tokens.

## Tool Categories

| Category | Tools | Description |
|:---------|:------|:------------|
| **File Operations** | `view_file`, `create_file`, `str_replace_editor`, `edit_file`, `multi_edit`, `codebase_replace` | Read, write, and edit files with multi-strategy matching |
| **Search** | `search`, `codebase_map`, `tool_search` (BM25), `grep`, `glob`, `list_files`, `tree` | Find code, patterns, and files |
| **System** | `bash`, `docker`, `kubernetes`, `run_script` | Execute commands and scripts (Python/JS/TS in Docker) |
| **Web** | `web_search`, `web_fetch`, `browser`, `firecrawl_search`, `firecrawl_scrape` | Search the web, fetch pages, automate browsers |
| **Patching** | `apply_patch` (Codex-style, 4-pass seek), `lsp_rename`, `lsp_code_action` | Apply diffs, LSP-powered refactoring |
| **Planning** | `plan`, `create_todo_list`, `get_todo_list`, `update_todo_list`, `reason` (ToT/MCTS) | Task planning and structured reasoning |
| **Media / Vision** | `screenshot`, `camera_snapshot`, `camera_analyze`, `vision_analyze`, `screen_memory`, `audio`, `video`, `ocr_extract`, `image_process`, `clipboard` | Screen + **webcam** capture, vision-model description via a local VLM (`camera_analyze` → ffmpeg snapshot → e.g. `ollama/gemma4:12b`), Screenpipe recall (`screen_memory`), OCR (Tesseract.js), image processing (Sharp) |
| **Documents** | `pdf`, `document`, `archive`, `execute_cell`, `execute_all` | PDF/Excel processing, Jupyter notebook execution |
| **Security** | `scan_secrets`, `scan_vulnerabilities`, `find_bugs` | Secret detection (14 patterns), CVE scanning, bug finder (25+ patterns, 6 languages) |
| **Code Quality** | `resolve_conflicts` | Merge conflict resolution |
| **Knowledge** | `knowledge_search`, `knowledge_add` | Search and add knowledge base entries |
| **Agent** | `spawn_agent`, `send_input`, `wait_agent`, `close_agent`, `resume_agent` | Multi-agent orchestration ([details](agents.md)) |
| **Self-Extension** | `create_skill`, `lessons_add`, `lessons_search` | Create new skills at runtime, persist learned patterns |
| **Human Input** | `ask_human` | Pause execution for mid-task user clarification (120s timeout) |
| **Utility** | `code_exec`, `request_permissions`, `terminate` | JS sandbox with tool bridge, dynamic permission escalation, loop exit |

## RAG Tool Selection

Not all ~110 tools are sent to the LLM every turn. The RAG-based tool selector (`src/codebuddy/tools.ts`) filters tools per query using embedding similarity. Only relevant tools are included in each API call, reducing prompt tokens significantly. Tools are cached after the first selection round.

## Computer Use (desktop automation over MCP)

When Code Buddy runs as an **MCP server** (`CodeBuddyMCPServer`), it exposes its
desktop-automation stack (AT-SPI/accessibility + nut-js + screenshots) as MCP
tools so any MCP client can drive the desktop cross-platform:

- **Read-only, always exposed**: `desktop_screenshot` (full/region PNG),
  `desktop_snapshot` (enumerate on-screen UI elements with refs + click
  coordinates).
- **Control, opt-in only**: `desktop_click`, `desktop_move_mouse`, `desktop_type`,
  `desktop_key` actuate the real desktop and are **registered only when
  `CODEBUDDY_MCP_DESKTOP_CONTROL=1`** (fail-closed by default).

On Linux the manager prefers `NutJsProvider` (libnut) when `xdotool`/`xclip`/
`wmctrl` are absent. This is the portable alternative to a Windows-only desktop
framework — see [`docs/screen-capture-and-ai.md`](screen-capture-and-ai.md).

## Edit Tool -- Multi-Strategy Matching

The `str_replace` operation tries 4+ matching strategies in cascade:

1. **Exact** -- literal `String.includes()` (fastest, confidence 1.0)
2. **Flexible** -- line-by-line with `trim()` normalization; preserves original indentation (confidence 0.95)
3. **Regex** -- splits on delimiters, joins with `\s*` pattern (confidence 0.85)
4. **Fuzzy** -- Levenshtein distance with whitespace penalty factor 0.1, threshold 10% (confidence 0.9+)
5. **LCS fallback** -- original `findBestFuzzyMatch()` at 90% similarity threshold

## apply_patch Format (Codex-style)

A custom patch format simpler than unified diff:

```
*** Begin Patch
*** Update File: src/main.ts
@@
 context line
-old line
+new line
*** End Patch
```

Operations: `Add File`, `Delete File`, `Update File` (with `Move to`). The `seek_sequence` algorithm tries 4 passes: exact, trailing-trim, full-trim, Unicode normalization.

## Streaming Adapter

9 tools support extended streaming for real-time output: `view_file`, `search`, `grep`, `web_fetch`, `list_files`, `tree`, and more. Line-based chunking sends results as they arrive.

## RTK Shell Output Compression

The `bash` tool can optionally route supported shell commands through
[RTK](https://github.com/rtk-ai/rtk) before execution. Enable it with:

```bash
CODEBUDDY_RTK=1 buddy
```

When enabled, Code Buddy calls `rtk rewrite <command>` before spawning Bash.
The integration is fail-open: if `rtk` is missing, returns no rewrite, times
out, or proposes a command that fails Code Buddy's normal safety checks, the
original command runs unchanged. Rewritten commands are revalidated before
execution and the default rewrite timeout is `CODEBUDDY_RTK_TIMEOUT_MS=1000`.

## Tool Aliases (Codex-style)

Tools have alternate names for compatibility: `shell_exec`, `file_read`, `browser_search`, etc. Defined in `src/tools/registry/tool-aliases.ts`.

## BM25 Tool Search

The `tool_search` tool uses BM25 ranking (k1=1.2, b=0.75) over tool metadata to discover relevant tools from large MCP sets. Useful when working with many MCP servers.

## Custom Tools

Add tools via three mechanisms:

- **MCP servers** -- configure in `.codebuddy/mcp.json`; tools are auto-discovered
- **Plugins** -- create a plugin in `~/.codebuddy/plugins/` with a `manifest.json`; register tools via `context.registerTool()`
- **Source code** -- create a class in `src/tools/`, add a definition in `src/codebuddy/tools.ts`, add execution in `CodeBuddyAgent.executeTool()`, register in `src/tools/registry/`

## Web Search (5-Provider Fallback)

| Priority | Provider | Key Required | Notes |
|:---------|:---------|:-------------|:------|
| 1 | Brave MCP | `BRAVE_API_KEY` + MCP | Richest results |
| 2 | Brave API | `BRAVE_API_KEY` | Country, language, freshness filters |
| 3 | Perplexity | `PERPLEXITY_API_KEY` or `OPENROUTER_API_KEY` | AI-synthesized answers |
| 4 | Serper | `SERPER_API_KEY` | Google Search results |
| 5 | DuckDuckGo | None | Free fallback |

## Browser Automation Proof Loop

The `browser` tool is Playwright-backed and now exposes a small
Stagehand-inspired proof loop without adding a new runtime dependency:

- `observe` captures an accessibility snapshot with actionable refs and
  surrounding page context.
- `extract` returns a compact URL/title/headings/actions/links/text
  readout, optionally filtered by `query`, `text` or `name`.
- `assert_text` checks that expected text is actually present on the page
  and returns an explicit pass/fail result for automated tests.

Use this shape for internet tasks that must be auditable:
`web_search` -> `web_fetch` -> `browser` `observe` -> `browser`
`extract` -> `browser` `assert_text` -> `memory_propose` or `remember` /
`lessons_add` only when the fact or workflow is proven. Prefer
`memory_propose` when the fact was inferred and should be reviewed before
future prompt injection.

`buildInternetProofPlan()` in `src/browser-automation/internet-proof-plan.ts`
turns that proof loop into a side-effect-free plan object so CLI, Cowork
or Fleet views can display the same sequence before any browser/network
operation runs.

`buildBrowserOperatorSessionDraft()` in
`src/browser-automation/browser-operator-session.ts` wraps an
`InternetScoutPlan` in a Manus-style operator contract: isolated vs local
browser mode, explicit consent state, dedicated tab label, stop control,
planned action log and proof export manifest. It is side-effect-free and
intended for CLI/Cowork review before any browser session is started.
Preview the same contract from the CLI with:

```bash
buddy tools browser-operator draft "verify a public form" \
  --source-url https://example.com/form \
  --requires-interaction \
  --expected-text "Thanks" \
  --mode local \
  --json
```

## Code Exec Tool

JavaScript sandbox with a tool bridge. The LLM writes JavaScript that calls `await tools.<name>(args)`. Helpers: `text()`, `store(key,val)`, `load(key)`, `yield_control()`. Runs in `vm.createContext` with no process/require access. 30s timeout.
